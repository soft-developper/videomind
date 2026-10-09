"use client";
// vm_youtube: the owner sends the video, or one of its clips, to their own
// YouTube channel. The upload runs on the server, so the page can be closed.
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Send } from "lucide-react";
import { clsx } from "clsx";
import {
  getYouTubeStatus, connectYouTube, disconnectYouTube, getPublications, publishToYouTube, retryPublication, getClips, ApiError,
  type PublicationInfo, type YouTubePrivacy, type ClipInfo,
} from "@/lib/api";

const clock = (sec: number) => {
  const s = Math.max(0, Math.floor(sec)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`;
};
const PRIVACY: Array<[YouTubePrivacy, string, string]> = [
  ["private", "Private", "Only you can see it on YouTube."],
  ["unlisted", "Unlisted", "Anyone with the link can see it."],
  ["public", "Public", "Everyone can find it."],
];
const RETURN_NOTE: Record<string, [boolean, string]> = {
  connected: [true, "Your YouTube channel is connected."],
  denied: [false, "YouTube was not connected because access was not allowed."],
  scope: [false, "YouTube was not connected because uploading was not allowed. Connect again and tick the upload permission."],
  expired: [false, "The connection took too long. Try again."],
  error: [false, "YouTube could not be connected. While VideoMind's Google app is in testing, only accounts added as test users can connect."],
};
const pct = (p: PublicationInfo) => (p.totalBytes ? Math.min(100, Math.floor((p.sentBytes / p.totalBytes) * 100)) : 0);

export function PublishPanel({ videoId, duration }: { videoId: string; duration: number }) {
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ["youtube-status"], queryFn: getYouTubeStatus });
  const pubs = useQuery({
    queryKey: ["publications", videoId],
    queryFn: () => getPublications(videoId),
    enabled: !!status.data?.enabled,
    // While an upload waits or runs, look again every few seconds.
    refetchInterval: (q) => (q.state.data?.publications.some((p) => p.status === "queued" || p.status === "uploading") ? 4000 : false),
  });
  const clips = useQuery({ queryKey: ["clips", videoId], queryFn: () => getClips(videoId), enabled: !!status.data?.connected });
  const readyClips = (clips.data?.clips ?? []).filter((c) => c.status === "ready");

  const [note, setNote] = useState<[boolean, string] | null>(null);
  const [source, setSource] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const [privacy, setPrivacy] = useState<YouTubePrivacy>("private");
  const [madeForKids, setMadeForKids] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [filled, setFilled] = useState(false);

  // Back from Google: show what happened, then take it out of the address.
  useEffect(() => {
    const url = new URL(window.location.href);
    const r = url.searchParams.get("youtube");
    if (!r) return;
    setNote(RETURN_NOTE[r] ?? RETURN_NOTE.error);
    url.searchParams.delete("youtube");
    window.history.replaceState(null, "", url.pathname + (url.search || "") + url.hash);
  }, []);

  useEffect(() => {
    if (filled || !pubs.data) return;
    setTitle(pubs.data.suggested.title);
    setDescription(pubs.data.suggested.description);
    setTags(pubs.data.suggested.tags.join(", "));
    setFilled(true);
  }, [pubs.data, filled]);

  const clip: ClipInfo | undefined = readyClips.find((c) => c.id === source);
  const length = clip ? clip.endSeconds - clip.startSeconds : duration;
  const short = clip && (clip.frame === "vertical" || clip.frame === "square") && length <= 180;

  if (!status.data) return null;
  if (!status.data.enabled) return null;

  const fail = (x: unknown) => setErr(x instanceof ApiError ? x.message : "That did not work. Try again.");

  const connect = async () => {
    setErr(null); setBusy(true);
    try { const { url } = await connectYouTube(window.location.pathname); window.location.assign(url); }
    catch (x) { fail(x); setBusy(false); }
  };
  const disconnect = async () => {
    if (!window.confirm("Disconnect YouTube? VideoMind will no longer be able to upload to your channel. Videos already there stay.")) return;
    setErr(null);
    try { await disconnectYouTube(); setNote(null); await qc.invalidateQueries({ queryKey: ["youtube-status"] }); }
    catch (x) { fail(x); }
  };
  const publish = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (madeForKids === null) { setErr("Say whether the video is made for kids. YouTube requires it."); return; }
    setErr(null); setBusy(true);
    try {
      await publishToYouTube(videoId, {
        clipId: source || null, title, description, privacy, madeForKids,
        tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
      });
      await qc.invalidateQueries({ queryKey: ["publications", videoId] });
    } catch (x) { fail(x); }
    finally { setBusy(false); }
  };
  const retry = async (p: PublicationInfo) => {
    setErr(null);
    try { await retryPublication(videoId, p.id); await qc.invalidateQueries({ queryKey: ["publications", videoId] }); }
    catch (x) { fail(x); }
  };

  const field = "w-full px-2.5 text-[13.5px]";
  const left = pubs.data ? Math.max(0, pubs.data.limits.perDay - pubs.data.limits.usedToday) : null;

  return (
    <section className="panel" aria-label="Publish to YouTube">
      <header className="flex items-center gap-2.5 px-5 h-11 border-b border-rule">
        <Send size={13} className="text-dim" />
        <span className="text-[14px] font-semibold text-paper">Publish to YouTube</span>
      </header>

      <div className="px-5 py-4 space-y-5">
        {note && <p className={clsx("text-[13.5px]", note[0] ? "text-paper-2" : "text-error")} role="status">{note[1]}</p>}

        {!status.data.connected ? (
          <div className="space-y-2.5 max-w-[62ch]">
            <p className="text-[13.5px] text-dim leading-relaxed">
              Connect your YouTube channel to send this video or its clips there. VideoMind only asks for permission to upload, and you can disconnect at any time.
            </p>
            {/* vm_legal: what YouTube API Services require users to agree to */}
            <p className="text-[12.5px] text-dim leading-relaxed" data-youtube-consent>
              By connecting, you agree to the{" "}
              <a href="https://www.youtube.com/t/terms" target="_blank" rel="noopener noreferrer" className="text-paper-2 underline underline-offset-2">YouTube Terms of Service</a>{" "}and VideoMind&rsquo;s{" "}
              <a href="/legal/privacy#google" target="_blank" rel="noopener noreferrer" className="text-paper-2 underline underline-offset-2">Privacy Policy</a>. Google&rsquo;s handling of your data is described in the{" "}
              <a href="http://www.google.com/policies/privacy" target="_blank" rel="noopener noreferrer" className="text-paper-2 underline underline-offset-2">Google Privacy Policy</a>.
            </p>
            <button onClick={connect} disabled={busy} className="btn btn-signal h-9 px-4">{busy ? "Opening Google" : "Connect YouTube"}</button>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3 flex-wrap text-[13.5px]">
              <span className="text-paper-2" data-youtube-account>Connected{status.data.email ? ` as ${status.data.email}` : ""}</span>
              <button onClick={disconnect} className="text-paper-2 hover:text-paper underline underline-offset-2 no-min">Disconnect</button>
              <a href="https://security.google.com/settings/security/permissions" target="_blank" rel="noopener noreferrer" className="text-dim hover:text-paper underline underline-offset-2">Google account access</a>
            </div>

            <form onSubmit={publish} className="space-y-3.5 max-w-[560px]" aria-label="Send to YouTube">
              {readyClips.length > 0 && (
                <div>
                  <label htmlFor="yt-source" className="block text-[12.5px] text-dim mb-1">What to send</label>
                  <select id="yt-source" value={source} onChange={(x) => setSource(x.target.value)} className={clsx(field, "h-9")}>
                    <option value="">The whole video ({clock(duration)})</option>
                    {readyClips.map((c) => <option key={c.id} value={c.id}>Clip: {c.title} ({clock(c.endSeconds - c.startSeconds)})</option>)}
                  </select>
                </div>
              )}
              <div>
                <label htmlFor="yt-title" className="block text-[12.5px] text-dim mb-1">YouTube title</label>
                <input id="yt-title" value={title} maxLength={100} onChange={(x) => setTitle(x.target.value)} className={clsx(field, "h-9")} required />
              </div>
              <div>
                <label htmlFor="yt-description" className="block text-[12.5px] text-dim mb-1">Description</label>
                <textarea id="yt-description" value={description} onChange={(x) => setDescription(x.target.value)} rows={6} className={clsx(field, "py-2 leading-relaxed")} />
              </div>
              <div>
                <label htmlFor="yt-tags" className="block text-[12.5px] text-dim mb-1">Tags, separated by commas</label>
                <input id="yt-tags" value={tags} onChange={(x) => setTags(x.target.value)} className={clsx(field, "h-9")} />
              </div>

              <fieldset className="space-y-1.5">
                <legend className="text-[12.5px] text-dim mb-1">Who can see it</legend>
                {PRIVACY.map(([k, label, hint]) => (
                  <label key={k} className="flex items-start gap-2.5 cursor-pointer">
                    <input type="radio" name="yt-privacy" checked={privacy === k} onChange={() => setPrivacy(k)} className="mt-1" />
                    <span><span className="block text-[13.5px] text-paper">{label}</span><span className="block text-[12.5px] text-dim">{hint}</span></span>
                  </label>
                ))}
              </fieldset>

              <fieldset className="space-y-1.5">
                <legend className="text-[12.5px] text-dim mb-1">Is it made for kids?</legend>
                {([[true, "Yes, it is made for kids"], [false, "No, it is not made for kids"]] as const).map(([v, label]) => (
                  <label key={String(v)} className="flex items-center gap-2.5 cursor-pointer text-[13.5px] text-paper">
                    <input type="radio" name="yt-kids" checked={madeForKids === v} onChange={() => setMadeForKids(v)} />
                    {label}
                  </label>
                ))}
              </fieldset>

              {short && <p className="text-[12.5px] text-dim">This clip is vertical or square and at most 3 minutes, so YouTube shows it as a Short.</p>}
              {length > 15 * 60 && <p className="text-[12.5px] text-dim">YouTube accepts videos over 15 minutes only from channels that have verified a phone number.</p>}

              <div className="flex items-center gap-3 flex-wrap">
                <button type="submit" disabled={busy || !title.trim() || left === 0} className="btn btn-signal h-9 px-4">{busy ? "Starting" : "Send to YouTube"}</button>
                {left != null && <span className="tc">{left} of {pubs.data!.limits.perDay} left today</span>}
              </div>
            </form>
          </>
        )}

        {err && <p className="text-[13px] text-error" role="alert">{err}</p>}

        {!!pubs.data?.publications.length && (
          <ul className="border-t border-rule" aria-label="Sent to YouTube">
            {pubs.data.publications.map((p) => (
              <li key={p.id} className="py-3 border-b border-rule last:border-b-0">
                <p className="text-[14px] text-paper truncate">{p.title}</p>
                <p className="tc mt-0.5">{p.clipId ? "Clip" : "Whole video"}, {PRIVACY.find(([k]) => k === p.privacy)?.[1]}</p>
                <p className={clsx("text-[13px] mt-1", p.status === "failed" ? "text-error" : p.status === "done" ? "text-paper-2" : "text-dim")} data-publication-status={p.status}>
                  {p.status === "queued" && "Waiting to upload"}
                  {p.status === "uploading" && `Uploading, ${pct(p)}%. You can leave this page.`}
                  {p.status === "done" && "On YouTube. It may take a few minutes before YouTube finishes processing it."}
                  {p.status === "failed" && `Not uploaded. ${p.error ?? ""}`}
                </p>
                {p.status === "uploading" && (
                  <div className="h-1 bg-slate-2 rounded mt-2 overflow-hidden" role="progressbar" aria-valuenow={pct(p)} aria-valuemin={0} aria-valuemax={100} aria-label={`Uploading ${p.title}`}>
                    <div className="h-full bg-signal" style={{ width: `${pct(p)}%` }} />
                  </div>
                )}
                <div className="flex items-center gap-3 mt-2 flex-wrap text-[13px]">
                  {p.url && <a href={p.url} target="_blank" rel="noopener noreferrer" className="btn btn-ghost h-8 px-3 text-[13px] inline-flex items-center">Open on YouTube</a>}
                  {p.studioUrl && <a href={p.studioUrl} target="_blank" rel="noopener noreferrer" className="text-paper-2 hover:text-paper underline underline-offset-2 no-min">Edit in YouTube Studio</a>}
                  {p.status === "failed" && status.data.connected && (
                    <button onClick={() => retry(p)} className="text-paper-2 hover:text-paper underline underline-offset-2 no-min">Try again</button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
