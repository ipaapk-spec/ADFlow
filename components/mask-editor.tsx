"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  asset: { id: string; url: string | null; width: number; height: number };
  onClose: () => void;
}

const BRUSHES = [
  { label: "细", value: 40 },
  { label: "中", value: 90 },
  { label: "粗", value: 160 },
];

export function MaskEditor({ asset, onClose }: Props) {
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const lastPoint = useRef<{ x: number; y: number } | null>(null);
  const [brush, setBrush] = useState(90);
  const [painted, setPainted] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState("fast");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [prices, setPrices] = useState<Record<string, number>>({});

  useEffect(() => {
    fetch("/api/models", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        const map: Record<string, number> = {};
        for (const m of data.models as { key: string; priceCny: number }[]) {
          map[m.key] = m.priceCny;
        }
        setPrices(map);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const point = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    };
  };

  const lineWidth = () => {
    const canvas = canvasRef.current;
    if (!canvas) return brush;
    const rect = canvas.getBoundingClientRect();
    return (brush * canvas.width) / Math.max(1, rect.width);
  };

  const start = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    canvas.setPointerCapture(event.pointerId);
    drawing.current = true;
    const p = point(event);
    lastPoint.current = p;
    ctx.strokeStyle = "rgba(255,255,255,1)";
    ctx.fillStyle = "rgba(255,255,255,1)";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = lineWidth();
    ctx.beginPath();
    ctx.arc(p.x, p.y, lineWidth() / 2, 0, Math.PI * 2);
    ctx.fill();
    setPainted(true);
  };

  const move = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !lastPoint.current) return;
    const p = point(event);
    ctx.lineWidth = lineWidth();
    ctx.beginPath();
    ctx.moveTo(lastPoint.current.x, lastPoint.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    lastPoint.current = p;
  };

  const end = () => {
    drawing.current = false;
    lastPoint.current = null;
  };

  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setPainted(false);
  };

  const submit = async () => {
    if (!canvasRef.current || !prompt.trim()) return;
    setSubmitting(true);
    setError("");
    try {
      const mask = canvasRef.current.toDataURL("image/png");
      const res = await fetch("/api/inpaint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assetId: asset.id, mask, prompt, model }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "提交失败");
      onClose();
      router.push(`/create?batch=${data.id}`);
    } catch (submitError) {
      setError((submitError as Error).message);
      setSubmitting(false);
    }
  };

  return (
    <div className="backdrop" onClick={onClose} style={{ zIndex: 70 }}>
      <div className="modal" style={{ width: "min(1080px,100%)" }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <b style={{ fontSize: 14 }}>区域重生成</b>
            <span className="muted" style={{ fontSize: 12, marginLeft: 8 }}>
              涂出想改的地方，只重画这一块，其余保持原样
            </span>
          </div>
          <button className="btn" onClick={onClose}>
            关闭
          </button>
        </div>

        <div className="modal-body" style={{ gridTemplateColumns: "minmax(0,1fr) 340px" }}>
          <div className="modal-figure" style={{ background: "#1a1916" }}>
            <div style={{ position: "relative", maxWidth: "100%", maxHeight: "68vh", lineHeight: 0 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={asset.url ?? ""}
                alt="原图"
                style={{ maxWidth: "100%", maxHeight: "68vh", display: "block", borderRadius: 6 }}
              />
              <canvas
                ref={canvasRef}
                width={asset.width}
                height={asset.height}
                onPointerDown={start}
                onPointerMove={move}
                onPointerUp={end}
                onPointerLeave={end}
                style={{
                  position: "absolute",
                  inset: 0,
                  width: "100%",
                  height: "100%",
                  cursor: "crosshair",
                  touchAction: "none",
                  opacity: 0.55,
                }}
              />
            </div>
          </div>

          <div className="modal-side">
            <div>
              <h4>画刷大小</h4>
              <div className="chips">
                {BRUSHES.map((item) => (
                  <button
                    key={item.value}
                    className={`chip ${brush === item.value ? "on" : ""}`}
                    onClick={() => setBrush(item.value)}
                  >
                    {item.label}
                  </button>
                ))}
                <button className="chip" onClick={clear}>
                  清除
                </button>
              </div>
            </div>

            <div>
              <h4>要变成什么</h4>
              <textarea
                value={prompt}
                placeholder="例如：把这一块换成木质桌面，光影自然衔接"
                onChange={(event) => setPrompt(event.target.value)}
                style={{ minHeight: 92 }}
              />
            </div>

            <div>
              <h4>档位</h4>
              <div className="chips">
                {["fast", "balanced"].map((key) => (
                  <button
                    key={key}
                    className={`chip ${model === key ? "on" : ""}`}
                    onClick={() => setModel(key)}
                  >
                    {key === "fast" ? "极速" : "均衡"} ¥{(prices[key] ?? 0).toFixed(2)}
                  </button>
                ))}
              </div>
            </div>

            <p className="muted" style={{ fontSize: 11.5, margin: 0, lineHeight: 1.6 }}>
              原理：按选区裁一块带上下文的图交给模型重画，再羽化贴回原位置。边缘可能有轻微接缝，涂得越准效果越好。
            </p>

            {error && <div style={{ color: "var(--danger)", fontSize: 12.5 }}>{error}</div>}

            <button
              className="btn-primary"
              disabled={!painted || !prompt.trim() || submitting}
              onClick={() => void submit()}
              style={{ marginTop: "auto" }}
            >
              {submitting ? "提交中…" : painted ? "开始重生成" : "先涂出区域"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
