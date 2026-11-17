"use client";

import { useEffect, useRef, useState } from "react";
import { Eraser } from "lucide-react";

/** لوحة توقيع باليد (لمس أو فأرة) — تحفظ التوقيع صورة PNG في حقل مخفي باسم signature */
export function SignaturePad({ name = "signature" }: { name?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [data, setData] = useState("");
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const c = canvas.current!;
    const ratio = window.devicePixelRatio || 1;
    c.width = c.offsetWidth * ratio;
    c.height = c.offsetHeight * ratio;
    const ctx = c.getContext("2d")!;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.4;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#0b2545";
  }, []);

  const pos = (e: React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const down = (e: React.PointerEvent) => {
    canvas.current!.setPointerCapture(e.pointerId);
    drawing.current = true;
    last.current = pos(e);
  };
  const move = (e: React.PointerEvent) => {
    if (!drawing.current || !last.current) return;
    const ctx = canvas.current!.getContext("2d")!;
    const p = pos(e);
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
  };
  const up = () => {
    if (!drawing.current) return;
    drawing.current = false;
    setData(canvas.current!.toDataURL("image/png"));
  };
  const clear = () => {
    const c = canvas.current!;
    c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
    setData("");
  };

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="label mb-0">التوقيع</span>
        <button type="button" onClick={clear} className="btn-ghost btn-sm">
          <Eraser className="h-4 w-4" /> مسح
        </button>
      </div>
      <canvas
        ref={canvas}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerLeave={up}
        className="h-40 w-full touch-none rounded-xl border-2 border-dashed border-line bg-white"
        aria-label="ارسم توقيعك هنا"
      />
      <p className="mt-1 text-xs text-ink-muted">ارسم توقيعك بإصبعك أو بالفأرة داخل المربع</p>
      <input type="hidden" name={name} value={data} />
    </div>
  );
}
