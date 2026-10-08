// src/services/claude.ts
// vm_claude: every call VideoMind makes to Claude goes through here.
//
//   * One model setting for the whole app (CLAUDE_MODEL, default
//     claude-sonnet-5-5), and a small fast one for routing a question to
//     the right videos (CLAUDE_MODEL_FAST, default claude-haiku-5-5).
//     Before, every call named claude-opus-4-5 in code.
//   * Answers come back as structured outputs: the request carries a JSON
//     schema (output_config.format) and Claude's answer is constrained to
//     it. Before, answers were asked for as "ONLY valid JSON" and taken
//     apart by hand, and an answer that did not parse was saved as
//     "Analysis pending."
//   * The answer is the text block. A model that thinks first returns
//     thinking blocks before it, so content[0] is not the answer.
//   * A refusal or an answer cut off by max_tokens is an error with a
//     name, not an empty result. An answer cut off is asked for once more
//     with twice the room.
//   * Every reply, including one that is retried, is written to the
//     usage ledger against the video's owner (see src/lib/usage.ts).
import Anthropic from "@anthropic-ai/sdk";
import "dotenv/config";
import { recordClaudeUsage } from "../lib/usage.js";

export function claudeModel(): string { return (process.env.CLAUDE_MODEL ?? "").trim() || "claude-sonnet-5-5"; }
export function claudeFastModel(): string { return (process.env.CLAUDE_MODEL_FAST ?? "").trim() || "claude-haiku-5-5"; }
type Effort = "low" | "medium" | "high" | "xhigh" | "max";
function effort(): Effort | undefined {
  const e = (process.env.CLAUDE_EFFORT ?? "").trim().toLowerCase();
  return (["low", "medium", "high", "xhigh", "max"] as const).find((x) => x === e);
}

let client: Anthropic | null = null;
function anthropic(): Anthropic {
  // An analysis of a long lecture can take a few minutes. A request that
  // hangs is cut off after ten, and tried once more by the SDK.
  client ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 10 * 60_000, maxRetries: 1 });
  return client;
}
/** Test hook: a new client picks up a changed environment. */
export function _resetClaude() { client = null; }

/** A Claude answer that cannot be used. `retryable` says whether asking again may help. */
export class ClaudeError extends Error {
  constructor(public code: "refusal" | "cut_off" | "invalid_output", message: string, public retryable: boolean) {
    super(message); this.name = "ClaudeError";
  }
}

export interface AskOptions {
  /** What the call is for, for logs only. */
  purpose: string;
  /** Plain text, or blocks (for example a transcript marked for prompt caching). */
  system: string | Anthropic.TextBlockParam[];
  user: string;
  schema: Record<string, unknown>;
  maxTokens: number;
  model?: string;
}

/** The text of the answer: the text blocks, after any thinking blocks. */
export function answerText(message: { content: Array<{ type: string; text?: string }> }): string {
  return message.content.filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
}

/**
 * Ask Claude for an answer shaped by `schema` and return it parsed.
 * The caller checks the meaning (ids that exist, times inside the video);
 * this checks only that an answer came back whole.
 */
export async function askClaude<T>(o: AskOptions): Promise<T> {
  let maxTokens = o.maxTokens;
  for (let round = 0; ; round++) {
    const e = effort();
    const message = await anthropic().messages.create({
      model: o.model ?? claudeModel(),
      max_tokens: maxTokens,
      system: o.system,
      messages: [{ role: "user", content: o.user }],
      output_config: { format: { type: "json_schema", schema: o.schema }, ...(e ? { effort: e } : {}) },
    });
    await recordClaudeUsage(message);

    if (message.stop_reason === "refusal") {
      throw new ClaudeError("refusal", `Claude declined to ${o.purpose}.`, false);
    }
    if (message.stop_reason === "max_tokens") {
      // The answer was cut off. Once more with twice the room, then give up.
      if (round === 0 && maxTokens < 64_000) { maxTokens = Math.min(maxTokens * 2, 64_000); continue; }
      throw new ClaudeError("cut_off", `Claude's answer to ${o.purpose} was longer than ${maxTokens} tokens.`, true);
    }
    const text = answerText(message as any);
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new ClaudeError("invalid_output", `Claude's answer to ${o.purpose} could not be read.`, true);
    }
  }
}

// ── shared pieces of schemas ──────────────────────────────────────────────
// Every object lists all its properties as required and allows no others:
// the documented way to keep the order of properties and to know exactly
// what comes back.

export const obj = (properties: Record<string, unknown>) => ({
  type: "object", properties, required: Object.keys(properties), additionalProperties: false,
});
export const str = (description?: string) => (description ? { type: "string", description } : { type: "string" });
export const num = (description?: string) => (description ? { type: "number", description } : { type: "number" });
export const list = (items: unknown, description?: string) => (description ? { type: "array", items, description } : { type: "array", items });

/**
 * A transcript as Claude reads it: one sentence a line, each led by the
 * second it starts at. Seconds, not mm:ss, so the times Claude gives back
 * are the numbers the player seeks to.
 */
export function transcriptLines(transcript: Array<{ start: number; text: string }>): string {
  return transcript.map((s) => `[${Math.floor(s.start)}] ${s.text}`).join("\n");
}

/**
 * What a route answers when a Claude call fails. A refusal is the
 * request's fault (422). An answer that came back unusable, a busy or
 * overloaded API (429, 529) and a timeout are worth trying again later
 * (503). Anything else is left to the route.
 */
export function claudeFailure(err: any): { status: number; error: string; code: string } | null {
  if (err instanceof ClaudeError) {
    return err.code === "refusal"
      ? { status: 422, code: "refused", error: "Claude declined to answer this. Try asking another way." }
      : { status: 503, code: "try_again", error: "The answer did not come back whole. Please try again." };
  }
  // The SDK's own errors: connection problems and answers with a status.
  if (err instanceof Anthropic.APIError) {
    const status = Number(err.status);
    if (!status || status === 408 || status === 429 || status === 529 || status >= 500) {
      return { status: 503, code: "busy", error: "The AI service is busy. Please try again in a minute." };
    }
  }
  return null;
}
