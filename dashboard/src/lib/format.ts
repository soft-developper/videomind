// vm_admin: shared number and date formats.
export const num = (x: number) => Math.round(x).toLocaleString();
export function bytes(b: number): string {
  if (b < 1024) return `${Math.round(b)} B`;
  const u = ["KB", "MB", "GB", "TB"]; let v = b / 1024, i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${u[i]}`;
}
export function duration(sec: number): string {
  const s = Math.round(sec);
  if (s < 60) return `${s} s`;
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h ? `${num(h)} h ${m} min` : `${m} min`;
}
export function tokens(t: number): string {
  if (t < 10_000) return num(t);
  if (t < 1_000_000) return `${Math.round(t / 1000)} K`;
  return `${(t / 1_000_000).toFixed(1)} M`;
}
export const when = (ms: number) => new Date(ms).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
export const day = (ms: number) => new Date(ms).toLocaleDateString([], { dateStyle: "medium" });
/** 0x1234...abcd */
export const short = (w: string) => (w.length > 14 ? `${w.slice(0, 8)}...${w.slice(-6)}` : w);
