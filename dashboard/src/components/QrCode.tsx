"use client";
// vm_admin: a QR code as an SVG, dark on white with its quiet zone.
import { useMemo } from "react";
import { qrGrid, qrPath, QUIET } from "@/lib/qr";

export function QrCode({ text, label, className }: { text: string; label: string; className?: string }) {
  const { n, d } = useMemo(() => { const g = qrGrid(text); return { n: g.length, d: qrPath(g) }; }, [text]);
  const size = n + QUIET * 2;
  return (
    <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label} shapeRendering="crispEdges" className={className}>
      <rect width={size} height={size} fill="#ffffff" />
      <path d={d} transform={`translate(${QUIET} ${QUIET})`} fill="#000000" />
    </svg>
  );
}
