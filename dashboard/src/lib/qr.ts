// vm_admin: the QR code for adding VideoMind to an authenticator app.
// Drawn in the browser from qrcode-generator (MIT, no dependencies);
// the secret is never sent to any other service.
import qrcode from "qrcode-generator";

/** The grid of a QR code for this text: true is a dark module. Error correction M. */
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
