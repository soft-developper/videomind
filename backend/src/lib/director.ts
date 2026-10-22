// src/lib/director.ts
// vm_director: Claude as the director of a generated video (Part 17c1).
//
// The wallet writes an idea in its own words, in any language. Claude picks
// the model that suits it from the ones the dashboard offers, the length and
// the shape, and writes the description in the way that model responds to.
// Nothing is generated here: the page fills the form with the suggestion and
// the wallet reads it, changes it if it wants, and starts it itself.
//
// What each model responds to, from its provider's guidance (22 Oct 2026):
//   Wan 3.0 (Alibaba): entity + scene + motion, then aesthetic control
//     (light, shot size, camera angle, lens, camera movement) and style; for
//     sound, the spoken lines with emotion, tone and speed, sound effects by
//     source, and music by style. About 2.5 s of speech per 5 s of video.
//   MiniMax H3 (fal guide): plain film language for the camera, timed beats
//     written as "[0 to 2 seconds] ...", sound directed like the picture,
//     spoken lines as "The character says: ...", and negative direction
//     ("No subtitles, no watermark").
//   Gemini Omni Flash (Google): clear, simple descriptions; no negative
//     prompt field, so exclusions go in the text; English is fully supported.
import { askClaude, obj, str, num, ClaudeError } from "../services/claude.js";
import { withUsage } from "./usage.js";
import { listModels, MAX_SHOTS, maxTotalSeconds, type ModelRow } from "./generation.js";
import { list } from "../services/claude.js";

export interface Direction {
  modelId: string; seconds: number; aspect: "16:9" | "9:16";
  prompt: string; title: string; why: string;
  /** Set when the idea cannot be made: the reason, in the wallet's language. */
  problem: string | null;
}

export class DirectorError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

const GUIDE: Array<{ match: (m: ModelRow) => boolean; text: string }> = [
  { match: (m) => m.endpoint.startsWith("alibaba/wan"), text:
    "Order the description: who or what (entity), where (scene), what happens (motion), then the look: light source and mood, shot size, camera angle, lens and one camera movement, then the style. Name one shot size and one camera move so the clip stays one shot. For sound: each spoken line in quotes with the emotion, tone and speed of the voice; sound effects by their source; music by its style. Allow about 2.5 seconds of speech for every 5 seconds of video." },
  { match: (m) => m.endpoint.startsWith("minimax/"), text:
    "Write the scene and style first, then the action beat by beat; for more than one beat use timed blocks such as \"[0 to 3 seconds] Wide shot of ...\". Describe the camera in plain film language (push in, handheld, rack focus, drone flying forward). Direct the sound like the picture: name the sounds and when they happen; for speech write \"The character says: ...\". End with what must not appear, for example: No subtitles, no on screen text, no watermark." },
  { match: (m) => m.provider === "google", text:
    "Write a clear, simple description in plain sentences: subject, action, setting, camera, light and sound. The clip is 8 seconds. There is no separate negative field, so state what must not appear inside the description." },
];

const SYSTEM = (models: ModelRow[]) => `You are the director for VideoMind, a video platform. A person describes a short video they want. You choose the model, the length and the shape, and you write the description that model will turn into a video.

The models you may choose from (choose only from these ids):
${models.map((m) => `- id "${m.id}": ${m.label}, ${m.minSeconds === m.maxSeconds ? `always ${m.maxSeconds} seconds` : `${m.minSeconds} to ${m.maxSeconds} seconds`}, ${m.resolution}. How to write for it: ${GUIDE.find((g) => g.match(m))?.text ?? "Plain, concrete sentences: subject, action, setting, camera, light, sound."}`).join("\n")}

How to choose:
- A person speaking to camera, dialogue or lip sync: prefer the model whose guidance covers spoken lines in detail.
- A longer single moment (over 15 seconds) needs a model that allows that length.
- When the person names a length, a shape or a model, keep it if the model allows it.
- Otherwise 8 seconds and wide (16:9), or vertical (9:16) when the idea is for phones, stories or shorts.

How to write the description:
- English, whatever language the person used, because the models follow English best. Keep any spoken line in the language the person wants it spoken in.
- One clear moment. Concrete nouns and verbs, not lists of styles. Under 1,500 characters.
- Never name or describe a real, identifiable person (a celebrity, a politician, a named private person) or a known character; describe an invented person instead.
- If the idea cannot be made (it asks for a real person's likeness, sexual content, content about minors that is not plainly innocent, violence meant to shock, or anything illegal), set "problem" to a short, kind explanation in the person's language and leave "prompt" empty. Otherwise "problem" is an empty string.

Also give a short title in the person's language, and "why": one sentence in the person's language on why you chose this model, length and shape.`;

type Raw = { modelId: string; seconds: number; aspect: string; prompt: string; title: string; why: string; problem: string };
const SCHEMA = obj({
  modelId: str("One of the model ids listed."),
  seconds: num("Length in seconds, inside the chosen model's range."),
  aspect: { type: "string", enum: ["16:9", "9:16"] },
  prompt: str("The description for the model, in English. Empty when there is a problem."),
  title: str("A short title in the person's language."),
  why: str("One sentence in the person's language: why this model, length and shape."),
  problem: str("Empty, or why this idea cannot be made, in the person's language."),
});

export type Ask = <T>(o: { purpose: string; system: string; user: string; schema: Record<string, unknown>; maxTokens: number }) => Promise<T>;

/** Ask Claude to direct an idea. Checks the answer against the models really offered. */
export async function direct(a: { wallet: string; idea: unknown; aspect?: unknown; seconds?: unknown; modelId?: unknown }, ask: Ask = askClaude): Promise<Direction> {
  const idea = typeof a.idea === "string" ? a.idea.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ").trim() : "";
  if (idea.length < 3) throw new DirectorError(400, "bad_prompt", "Describe the video you want.");
  if (idea.length > 2000) throw new DirectorError(400, "bad_prompt", "Keep the description under 2,000 characters.");
  const models = (await listModels()).filter((m) => m.enabled && m.ready);
  if (!models.length) throw new DirectorError(503, "model_unavailable", "That model cannot be used right now. Try another one.");
  const wishes: string[] = [];
  if (a.modelId && models.some((m) => m.id === a.modelId)) wishes.push(`The person picked the model "${a.modelId}"; keep it unless it cannot make this idea.`);
  if (a.aspect === "16:9" || a.aspect === "9:16") wishes.push(`The person picked the shape ${a.aspect}.`);
  if (Number.isFinite(Number(a.seconds)) && Number(a.seconds) > 0) wishes.push(`The person picked about ${Math.round(Number(a.seconds))} seconds.`);
  const raw = await withUsage({ feature: "generate_direct", ownerWallet: a.wallet, actorWallet: a.wallet }, () => ask<Raw>({
    purpose: "direct a generated video",
    system: SYSTEM(models),
    user: `${wishes.length ? wishes.join(" ") + "\n\n" : ""}The person's idea:\n<idea>\n${idea}\n</idea>`,
    schema: SCHEMA, maxTokens: 2000,
  }));
  // Claude's choices are kept only inside what the server really allows.
  const model = models.find((m) => m.id === raw.modelId) ?? models[0];
  const secs = Math.round(Number(raw.seconds));
  const seconds = Math.min(model.maxSeconds, Math.max(model.minSeconds, Number.isFinite(secs) ? secs : 8));
  const problem = String(raw.problem ?? "").trim();
  return {
    modelId: model.id, seconds, aspect: raw.aspect === "9:16" ? "9:16" : "16:9",
    prompt: problem ? "" : String(raw.prompt ?? "").trim().slice(0, 2000),
    title: String(raw.title ?? "").trim().slice(0, 120),
    why: String(raw.why ?? "").trim().slice(0, 400),
    problem: problem ? problem.slice(0, 600) : null,
  };
}

// ── vm_generate: a story of several shots (Part 17c3) ────────────────────────
export interface StoryDirection {
  modelId: string; aspect: "16:9" | "9:16"; title: string; why: string; problem: string | null;
  shots: Array<{ prompt: string; seconds: number }>;
}
type RawStory = { modelId: string; aspect: string; title: string; why: string; problem: string; shots: Array<{ prompt: string; seconds: number }> };

const STORY = (models: ModelRow[]) => SYSTEM(models) + `

This time the person wants a longer video told in several shots, made one after another with the same model and joined in order.
- Write from 2 to ${MAX_SHOTS} shots; all shots together at most ${maxTotalSeconds()} seconds, each inside the chosen model's range.
- Each shot is made on its own, without seeing the others, so each description must stand alone: repeat the same description of every person (age, hair, clothes) and of the place, word for word, in every shot where they appear. Keep the light, colors and camera style the same across shots.
- One clear moment per shot; the shots together tell the idea from start to end.
- Write each shot the way the chosen model responds to, as above.`;

const STORY_SCHEMA = obj({
  modelId: str("One of the model ids listed."),
  aspect: { type: "string", enum: ["16:9", "9:16"] },
  title: str("A short title in the person's language."),
  why: str("One sentence in the person's language: why this model and shape, and how the shots tell the idea."),
  problem: str("Empty, or why this idea cannot be made, in the person's language."),
  shots: list(obj({ prompt: str("This shot's description for the model, in English, standing alone."), seconds: num("This shot's length in seconds.") })),
});

/** Ask Claude to split an idea into shots. Checked against what the server allows. */
export async function directStory(a: { wallet: string; idea: unknown; aspect?: unknown; modelId?: unknown; shots?: unknown }, ask: Ask = askClaude): Promise<StoryDirection> {
  const idea = typeof a.idea === "string" ? a.idea.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ").trim() : "";
  if (idea.length < 3) throw new DirectorError(400, "bad_prompt", "Describe the video you want.");
  if (idea.length > 2000) throw new DirectorError(400, "bad_prompt", "Keep the description under 2,000 characters.");
  const models = (await listModels()).filter((m) => m.enabled && m.ready);
  if (!models.length) throw new DirectorError(503, "model_unavailable", "That model cannot be used right now. Try another one.");
  const wishes: string[] = [];
  if (a.modelId && models.some((m) => m.id === a.modelId)) wishes.push(`The person picked the model "${a.modelId}"; keep it unless it cannot make this idea.`);
  if (a.aspect === "16:9" || a.aspect === "9:16") wishes.push(`The person picked the shape ${a.aspect}.`);
  const want = Math.round(Number(a.shots));
  if (Number.isFinite(want) && want >= 2 && want <= MAX_SHOTS) wishes.push(`The person wants ${want} shots.`);
  const raw = await withUsage({ feature: "generate_direct", ownerWallet: a.wallet, actorWallet: a.wallet }, () => ask<RawStory>({
    purpose: "direct a video of several shots",
    system: STORY(models),
    user: `${wishes.length ? wishes.join(" ") + "\n\n" : ""}The person's idea:\n<idea>\n${idea}\n</idea>`,
    schema: STORY_SCHEMA, maxTokens: 6000,
  }));
  const model = models.find((m) => m.id === raw.modelId) ?? models[0];
  const problem = String(raw.problem ?? "").trim();
  const base = { modelId: model.id, aspect: (raw.aspect === "9:16" ? "9:16" : "16:9") as "16:9" | "9:16", title: String(raw.title ?? "").trim().slice(0, 120), why: String(raw.why ?? "").trim().slice(0, 400) };
  if (problem) return { ...base, problem: problem.slice(0, 600), shots: [] };
  // Each shot inside the model's range; shots past the total are dropped, and at least two are kept.
  const shots: Array<{ prompt: string; seconds: number }> = [];
  let total = 0;
  for (const x of (Array.isArray(raw.shots) ? raw.shots : []).slice(0, MAX_SHOTS)) {
    const prompt = String(x?.prompt ?? "").trim().slice(0, 2000);
    if (prompt.length < 3) continue;
    const secs = Math.min(model.maxSeconds, Math.max(model.minSeconds, Math.round(Number(x?.seconds)) || model.minSeconds));
    if (total + secs > maxTotalSeconds()) break;
    shots.push({ prompt, seconds: secs }); total += secs;
  }
  if (shots.length < 2) throw new DirectorError(503, "try_again", "The answer did not come back whole. Please try again.");
  return { ...base, problem: null, shots };
}

export { ClaudeError };
