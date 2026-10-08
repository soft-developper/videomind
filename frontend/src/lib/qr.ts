// vm_present: QR codes and shared links, made in the browser.
//
// The code is drawn from the module grid that qrcode-generator works out
// (zero dependencies, MIT). Nothing is sent anywhere to make a code.
import qrcode from "qrcode-generator";

/** The address of a video's shared page, optionally at a moment (whole seconds). */
export function sharedLink(videoId: string, atSeconds?: number | null, origin?: string): string {
  const base = origin ?? (typeof window === "undefined" ? "" : window.location.origin);
  const t = atSeconds != null && atSeconds >= 1 ? Math.floor(atSeconds) : 0;
  return `${base}/v/${videoId}${t ? `?t=${t}` : ""}`;
}

/** The grid of a QR code for this text: true is a dark module. Error correction M (15 percent). */
export function qrGrid(text: string): boolean[][] {
  const q = qrcode(0, "M");
  q.addData(text, "Byte");
  q.make();
  const n = q.getModuleCount();
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => q.isDark(r, c)));
}

/** One SVG path for every dark module, in module units. */
export function qrPath(grid: boolean[][]): string {
  let d = "";
  grid.forEach((row, r) => {
    let c = 0;
    while (c < row.length) {
      if (!row[c]) { c++; continue; }
      let run = 1;
      while (c + run < row.length && row[c + run]) run++;
      d += `M${c} ${r}h${run}v1h-${run}z`;
      c += run;
    }
  });
  return d;
}

/** The standard quiet zone around a code is 4 modules. */
export const QUIET = 4;

/** Save the code as a PNG, dark on white, large enough to print or put on a slide. */
export function downloadQrPng(text: string, filename: string, px = 1200): void {
  const grid = qrGrid(text);
  const cells = grid.length + QUIET * 2;
  const unit = Math.max(4, Math.floor(px / cells));
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = cells * unit;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#000000";
  grid.forEach((row, r) => row.forEach((dark, c) => {
    if (dark) ctx.fillRect((c + QUIET) * unit, (r + QUIET) * unit, unit, unit);
  }));
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, "image/png");
}
