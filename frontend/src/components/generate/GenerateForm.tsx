"use client";
// vm_generate: make a video from a description (Part 17b2).
//
// The wallet writes what it wants, picks a model, a length and a shape, and
// sees the price before it starts. The server holds the price, a model
// makes the video, and the page of the new video shows its progress; once
// it arrives it is processed like an upload. Only open to the wallets the
// dashboard allows.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { clsx } from "clsx";
import { AlertTriangle, Sparkles, Plus, X } from "lucide-react";
import { ApiError, getGenerateInfo, startGeneration, directGeneration, directStory, type ShotInput } from "@/lib/api";
import { useSessionWallet } from "@/components/layout/AuthProvider";
import { useCredits, AddCreditsLink, isNoCredits } from "@/components/credits/Credits";
import { useMoney, inline } from "@/lib/format";
import { localize } from "@/lib/errorText";

const MAX = 2000;
type Aspect = "16:9" | "9:16";
type Visibility = "private" | "unlisted" | "public";

/** Whether the signed in wallet may generate (for the menu). */
export function useGenerateAllowed(): boolean {
  const wallet = useSessionWallet();
  const q = useQuery({ queryKey: ["generate-info", wallet ?? null], queryFn: getGenerateInfo, enabled: !!wallet, staleTime: 5 * 60_000, retry: false });
  return !!q.data?.allowed;
}

export function GenerateForm() {
  const t = useTranslations("generatePage");
  const tc = useTranslations("common");
  const tcr = useTranslations("credits");
  const wallet = useSessionWallet();
  const router = useRouter();
  const qc = useQueryClient();
  const money = useMoney();
  const credits = useCredits();
  const info = useQuery({ queryKey: ["generate-info", wallet ?? null], queryFn: getGenerateInfo, enabled: !!wallet, staleTime: 30_000, retry: false });
  const [prompt, setPrompt] = useState("");
  const [modelId, setModelId] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(8);
  const [aspect, setAspect] = useState<Aspect>("16:9");
  const [title, setTitle] = useState("");
  const [visibility, setVisibility] = useState<Visibility>("private");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ text: string; code?: string } | null>(null);
  // vm_director: AI writes the description; the wallet's own words can be put back.
  const [directing, setDirecting] = useState(false);
  const [note, setNote] = useState<{ kind: "chosen" | "problem"; text: string } | null>(null);
  const [before, setBefore] = useState<string | null>(null);
  // vm_generate: one shot, or several made one after another and joined (Part 17c3)
  const [mode, setMode] = useState<"one" | "shots">("one");
  const [shots, setShots] = useState<ShotInput[]>([]);
  const [wantShots, setWantShots] = useState(0); // 0: let AI decide

  const models = info.data?.models ?? [];
  const model = models.find((m) => m.id === modelId) ?? models[0] ?? null;
  // The first model is chosen until the wallet picks one; the length stays inside what it can make.
  useEffect(() => { if (!modelId && models[0]) setModelId(models[0].id); }, [modelId, models]);
  useEffect(() => {
    if (!model) return;
    const fit = (s: number) => Math.min(model.maxSeconds, Math.max(model.minSeconds, s));
    setSeconds(fit);
    setShots((list) => list.map((x) => ({ ...x, seconds: fit(x.seconds) })));
  }, [model]);

  if (!wallet) return <p className="text-[14px] text-paper-2" data-generate="signin">{t("signIn")}</p>;
  if (info.isLoading) return <div className="h-48 scan rounded-lg" />;
  if (info.isError) return <p role="alert" className="text-[14px] text-error">{t("loadFailed")}</p>;
  if (!info.data?.allowed) return <p className="text-[14px] text-paper-2" data-generate="closed">{t("notAllowed")}</p>;
  if (!models.length) return <p className="text-[14px] text-paper-2" data-generate="nomodels">{t("noModels")}</p>;

  const fixed = !!model && model.minSeconds === model.maxSeconds;
  const maxShots = info.data.maxShots ?? 6, maxTotal = info.data.maxTotalSeconds ?? 60;
  const many = mode === "shots";
  const shotSecs = (x: ShotInput) => (fixed ? model!.maxSeconds : x.seconds);
  const total = shots.reduce((t, x) => t + shotSecs(x), 0);
  const secs = many ? total : fixed ? model!.maxSeconds : seconds;
  const perSecond = credits.costOf("generate_video");
  const price = perSecond != null ? Math.ceil(perSecond * secs) : null;
  const short = price != null && credits.available != null && credits.available < price;
  const trimmed = prompt.trim();
  const shotsOk = shots.length >= 2 && shots.length <= maxShots && total <= maxTotal && shots.every((x) => x.prompt.trim().length >= 3 && x.prompt.trim().length <= MAX);
  const canStart = !busy && !!model && !info.data.budgetReached && !short && (many ? shotsOk : trimmed.length >= 3 && trimmed.length <= MAX);

  const letAiWrite = async () => {
    if (directing || busy || trimmed.length < 3 || trimmed.length > MAX) return;
    setDirecting(true); setErr(null); setNote(null);
    try {
      if (many) {
        // The idea stays as it is; the shots are written below it.
        const d = await directStory({ idea: trimmed, aspect, modelId: model?.id, shots: wantShots || undefined });
        if (d.problem) { setNote({ kind: "problem", text: d.problem }); return; }
        const m = models.find((x) => x.id === d.modelId);
        setShots(d.shots); setModelId(d.modelId); setAspect(d.aspect);
        if (!title.trim() && d.title) setTitle(d.title);
        setNote({ kind: "chosen", text: t("chosenShots", { model: m?.label ?? d.modelId, count: d.shots.length, n: d.shots.reduce((x, y) => x + y.seconds, 0), shape: d.aspect === "9:16" ? t("vertical") : t("wide"), why: d.why }) });
        return;
      }
      const d = await directGeneration({ idea: trimmed, aspect, seconds: secs, modelId: model?.id });
      if (d.problem) { setNote({ kind: "problem", text: d.problem }); return; }
      const m = models.find((x) => x.id === d.modelId);
      setBefore(prompt); setPrompt(d.prompt); setModelId(d.modelId); setSeconds(d.seconds); setAspect(d.aspect);
      if (!title.trim() && d.title) setTitle(d.title);
      setNote({ kind: "chosen", text: t("chosen", { model: m?.label ?? d.modelId, n: d.seconds, shape: d.aspect === "9:16" ? t("vertical") : t("wide"), why: d.why }) });
    } catch (e) {
      setErr({ text: e instanceof ApiError ? localize(e.message) : t("directFailed"), code: e instanceof ApiError ? e.code : undefined });
    } finally { setDirecting(false); }
  };
  const undo = () => { if (before != null) { setPrompt(before); setBefore(null); setNote(null); } };

  const start = async () => {
    if (!canStart || !model) return;
    setBusy(true); setErr(null);
    try {
      const r = await startGeneration({ prompt: many ? (trimmed || shots[0].prompt) : trimmed, modelId: model.id, seconds: secs, aspect, title: title.trim() || undefined, visibility,
        ...(many ? { shots: shots.map((x) => ({ prompt: x.prompt.trim(), seconds: shotSecs(x) })) } : {}) });
      qc.invalidateQueries({ queryKey: ["my-credits"] });
      qc.invalidateQueries({ queryKey: ["videos"] });
      router.push(`/video/${r.videoId}`);
    } catch (e) {
      setErr({ text: e instanceof ApiError ? localize(e.message) : t("startFailed"), code: e instanceof ApiError ? e.code : undefined });
      setBusy(false);
    }
  };

  const chip = (on: boolean) => clsx("btn h-9 px-3.5 text-[13.5px] no-min", on ? "border-paper-2 text-paper bg-paper/[0.06]" : "btn-ghost");
  return (
    <div className="space-y-6" data-generate="form">
      <div role="radiogroup" aria-label={t("modeLabel")} className="flex gap-2 flex-wrap" data-generate-mode={mode}>
        <button type="button" role="radio" aria-checked={!many} onClick={() => { setMode("one"); setNote(null); }} disabled={busy} className={chip(!many)}>{t("modeOne")}</button>
        <button type="button" role="radio" aria-checked={many} onClick={() => { setMode("shots"); setNote(null); setBefore(null); }} disabled={busy} className={chip(many)}>{t("modeShots")}</button>
      </div>
      <div>
        <label htmlFor="gen-prompt" className="block text-[14px] font-medium text-paper">{many ? t("ideaLabel") : t("promptLabel")}</label>
        <p id="gen-prompt-hint" className="text-[13px] text-dim mt-0.5">{many ? t("ideaHint", { max: maxShots, total: maxTotal }) : t("promptHint")}</p>
        <textarea id="gen-prompt" value={prompt} onChange={(e) => setPrompt(e.target.value.slice(0, MAX + 200))} rows={6} dir="auto"
          aria-describedby="gen-prompt-hint" placeholder={t("placeholder")} disabled={busy}
          className="mt-2 w-full px-3 py-2.5 text-[14px] leading-relaxed resize-y min-h-[140px]" data-generate-prompt />
        <div className="mt-1.5 flex items-start gap-3 flex-wrap">
          <button type="button" onClick={() => void letAiWrite()} disabled={directing || busy || trimmed.length < 3 || trimmed.length > MAX}
            className="btn btn-ghost h-9 px-3.5 text-[13.5px] inline-flex items-center gap-1.5 no-min" data-generate-direct>
            <Sparkles size={14} aria-hidden /> {directing ? t("directing") : many ? t("directShots") : t("direct")}
          </button>
          {many && (
            <label className="text-[13px] text-dim inline-flex items-center gap-2 mt-1.5">
              {t("howMany")}
              <select value={wantShots} onChange={(e) => setWantShots(Number(e.target.value))} disabled={directing || busy} className="h-8 px-2 text-[13px]" data-generate-want>
                <option value={0}>{t("aiDecides")}</option>
                {Array.from({ length: maxShots - 1 }, (_, i) => i + 2).map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
            </label>
          )}
          {before != null && <button type="button" onClick={undo} disabled={directing || busy} className="text-[13px] text-dim underline hover:text-paper no-min mt-2" data-generate-undo>{t("undo")}</button>}
          <p className={clsx("text-[12px] mt-2.5 ms-auto tabular-nums", trimmed.length > MAX ? "text-error" : "text-dim")}>{t("count", { n: trimmed.length, max: MAX })}</p>
        </div>
        {!many && <p className="text-[12.5px] text-dim mt-1">{t("directHint")}</p>}
        {note && (
          <p role="status" className={clsx("text-[13px] mt-2 leading-relaxed", note.kind === "problem" ? "text-warn" : "text-paper-2")} data-generate-note={note.kind}>{note.text}</p>
        )}
      </div>

      <fieldset>
        <legend className="text-[14px] font-medium text-paper">{t("model")}</legend>
        <div className="mt-2 grid sm:grid-cols-2 gap-2">
          {models.map((m) => (
            <label key={m.id} className={clsx("flex items-start gap-3 rounded border px-3 py-2.5 cursor-pointer", model?.id === m.id ? "border-paper-2 bg-paper/[0.04]" : "border-rule hover:border-paper-2/60")} data-generate-model={m.id}>
              <input type="radio" name="gen-model" checked={model?.id === m.id} onChange={() => setModelId(m.id)} disabled={busy} className="mt-1" />
              <span className="min-w-0">
                <span className="block text-[14px] text-paper">{m.label}</span>
                <span className="block text-[12.5px] text-dim">{m.minSeconds === m.maxSeconds ? t("fixedSeconds", { n: m.maxSeconds }) : t("range", { min: m.minSeconds, max: m.maxSeconds })}{t("sep")}{m.resolution}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {many && (
        <fieldset data-generate-shots>
          <legend className="text-[14px] font-medium text-paper">{t("shotsTitle")}</legend>
          {shots.length === 0 && <p className="text-[13px] text-dim mt-1">{t("shotsEmpty")}</p>}
          <ol className="mt-2 space-y-3">
            {shots.map((x, i) => (
              <li key={i} className="rounded border border-rule p-3" data-generate-shot={i}>
                <div className="flex items-center gap-3">
                  <span className="text-[13px] font-medium text-paper">{t("shot", { n: i + 1 })}</span>
                  {fixed ? <span className="text-[12.5px] text-dim">{t("fixedSeconds", { n: model!.maxSeconds })}</span> : (
                    <span className="flex items-center gap-2">
                      <input type="range" min={model!.minSeconds} max={model!.maxSeconds} step={1} value={x.seconds} disabled={busy} aria-label={t("shotLength", { n: i + 1 })}
                        onChange={(e) => setShots((l) => l.map((y, j) => (j === i ? { ...y, seconds: Number(e.target.value) } : y)))} className="w-32" />
                      <span className="text-[12.5px] text-paper tabular-nums w-10">{t("seconds", { n: x.seconds })}</span>
                    </span>
                  )}
                  <button type="button" onClick={() => setShots((l) => l.filter((_, j) => j !== i))} disabled={busy} aria-label={t("removeShot", { n: i + 1 })} className="ms-auto text-dim hover:text-paper no-min"><X size={15} /></button>
                </div>
                <textarea value={x.prompt} onChange={(e) => setShots((l) => l.map((y, j) => (j === i ? { ...y, prompt: e.target.value.slice(0, MAX + 200) } : y)))} rows={3} dir="auto" disabled={busy}
                  aria-label={t("shot", { n: i + 1 })} className="mt-2 w-full px-3 py-2 text-[13.5px] leading-relaxed resize-y" />
              </li>
            ))}
          </ol>
          <div className="mt-2 flex items-center gap-3 flex-wrap">
            <button type="button" onClick={() => setShots((l) => [...l, { prompt: "", seconds: Math.min(model!.maxSeconds, Math.max(model!.minSeconds, 5)) }])} disabled={busy || shots.length >= maxShots}
              className="btn btn-ghost h-9 px-3.5 text-[13.5px] inline-flex items-center gap-1.5 no-min" data-generate-add-shot><Plus size={14} aria-hidden /> {t("addShot")}</button>
            <p className={clsx("text-[13px] tabular-nums", total > maxTotal ? "text-error" : "text-dim")} data-generate-total>{t("total", { n: total, max: maxTotal })}</p>
          </div>
          <p className="text-[12.5px] text-dim mt-1.5">{t("shotsHint")}</p>
        </fieldset>
      )}

      <div className="flex gap-x-10 gap-y-5 flex-wrap">
        {!many && <div>
          <p className="text-[14px] font-medium text-paper" id="gen-len">{t("length")}</p>
          {fixed ? <p className="text-[13.5px] text-paper-2 mt-2">{t("fixedSeconds", { n: secs })}</p> : (
            <div className="flex items-center gap-3 mt-2">
              <input type="range" min={model!.minSeconds} max={model!.maxSeconds} step={1} value={seconds} onChange={(e) => setSeconds(Number(e.target.value))}
                aria-labelledby="gen-len" disabled={busy} className="w-44" data-generate-seconds />
              <span className="text-[13.5px] text-paper tabular-nums w-16">{t("seconds", { n: seconds })}</span>
            </div>
          )}
        </div>}
        <div role="radiogroup" aria-labelledby="gen-shape">
          <p className="text-[14px] font-medium text-paper" id="gen-shape">{t("shape")}</p>
          <div className="flex gap-2 mt-2">
            <button type="button" role="radio" aria-checked={aspect === "16:9"} onClick={() => setAspect("16:9")} disabled={busy} className={chip(aspect === "16:9")}>{t("wide")}</button>
            <button type="button" role="radio" aria-checked={aspect === "9:16"} onClick={() => setAspect("9:16")} disabled={busy} className={chip(aspect === "9:16")}>{t("vertical")}</button>
          </div>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-5">
        <label className="block">
          <span className="block text-[14px] font-medium text-paper">{t("titleLabel")}</span>
          <span className="block text-[13px] text-dim mt-0.5">{t("titleHint")}</span>
          <input value={title} onChange={(e) => setTitle(e.target.value.slice(0, 120))} dir="auto" disabled={busy} className="mt-2 h-10 px-3 w-full text-[14px]" />
        </label>
        <fieldset>
          <legend className="text-[14px] font-medium text-paper">{t("visibility")}</legend>
          <div className="flex gap-2 mt-2 flex-wrap">
            {(["private", "unlisted", "public"] as const).map((v) => (
              <button key={v} type="button" role="radio" aria-checked={visibility === v} onClick={() => setVisibility(v)} disabled={busy} className={chip(visibility === v)}>{tc(`visibility.${v}`)}</button>
            ))}
          </div>
          <p className="text-[12.5px] text-dim mt-1.5">{tc(`visibilityHint.${visibility}`)}</p>
        </fieldset>
      </div>

      <p className="text-[13px] text-dim max-w-[70ch]">{t("aiNotice")}</p>

      {err && (
        <div role="alert" className="rounded-md border border-error/50 bg-error/5 p-3.5 flex items-start gap-3">
          <AlertTriangle size={15} className="text-error shrink-0 mt-0.5" />
          <p className="text-[13.5px] text-error leading-relaxed">{err.text}{(isNoCredits(err.code) || err.code === "storage_unpaid") && <> <AddCreditsLink /></>}</p>
        </div>
      )}
      {info.data.budgetReached && <p className="text-[13.5px] text-warn" data-generate="budget">{t("budget")}</p>}

      <div className="space-y-2">
        {price != null && (
          <p className={clsx("text-[13px]", short ? "text-warn" : "text-dim")} data-generate-price>
            {t("price", { price: inline(money(price)), n: secs, perSecond: inline(money(perSecond!)) })}
            {credits.available != null && <> {tcr("have", { amount: inline(money(credits.available)) })}</>}
            {short && <> <Link href="/wallet" className="underline hover:text-paper">{tcr("add")}</Link></>}
          </p>
        )}
        <button onClick={() => void start()} disabled={!canStart} data-generate-start
          className={clsx("w-full h-11 rounded text-[14px] font-medium transition-colors border", canStart ? "bg-paper border-paper text-void hover:bg-white" : "bg-transparent border-rule text-dim cursor-not-allowed")}>
          {busy ? t("starting") : many ? (shots.length < 2 ? t("shotsFirst") : t("startShots", { count: shots.length })) : trimmed.length < 3 ? t("writeFirst") : t("start")}
        </button>
      </div>
    </div>
  );
}
