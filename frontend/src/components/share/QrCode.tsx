"use client";
// vm_present: a QR code as an SVG. Always dark on white with its quiet
// zone, whatever the theme, because phone cameras read that best.
import { useMemo } from "react";
import { qrGrid, qrPath, QUIET } from "@/lib/qr";

export function QrCode({ text, label, className }: { text: string; label: string; className?: string }) {
  const { n, d } = useMemo(() => {
    const grid = qrGrid(text);
    return { n: grid.length, d: qrPath(grid) };
  }, [text]);
  const size = n + QUIET * 2;
  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={label}
      data-qr={text}
      shapeRendering="crispEdges"
      className={className}
    >
      <rect width={size} height={size} fill="#ffffff" />
      <path d={d} transform={`translate(${QUIET} ${QUIET})`} fill="#000000" />
    </svg>
  );
}
