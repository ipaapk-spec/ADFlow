"use client";

import { useEffect, useRef, useState } from "react";
import { CROP_PRESETS, type CropPreset } from "@/lib/crop";

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

type Handle = "nw" | "ne" | "sw" | "se";

interface Saved {
  id: string;
  url: string;
  width: number;
  height: number;
}

interface DragState {
  mode: "move" | "resize";
  handle?: Handle;
  startX: number;
  startY: number;
  box: Box;
  rect: { width: number; height: number };
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max));

export function CropEditor({
  asset,
  onClose,
}: {
  asset: { id: string; url: string | null; width: number; height: number };
  onClose: () => void;
}) {
  const [ratio, setRatio] = useState<CropPreset["key"] | null>(null);
  const [box, setBox] = useState<Box | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState<Saved | null>(null);

  const imageRef = useRef<HTMLImageElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const boxRef = useRef<Box | null>(null);
  boxRef.current = box;
  const presetRef = useRef<CropPreset | null>(null);
  presetRef.current = ratio ? CROP_PRESETS[ratio] : null;
  const sizeRef = useRef({ w: asset.width || 1, h: asset.height || 1 });
  sizeRef.current = { w: asset.width || 1, h: asset.height || 1 };

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      const preset = presetRef.current;
      if (!drag || !preset) return;
      const { box: base, rect } = drag;
      const dx = (event.clientX - drag.startX) / rect.width;
      const dy = (event.clientY - drag.startY) / rect.height;

      if (drag.mode === "move") {
        setBox({
          ...base,
          x: clamp(base.x + dx, 0, 1 - base.w),
          y: clamp(base.y + dy, 0, 1 - base.h),
        });
        return;
      }

      const image = sizeRef.current;
      const ratioNorm = (preset.width / preset.height) * (image.h / image.w);
      const handle = drag.handle ?? "se";
      const isLeft = handle.includes("w");
      const isTop = handle.includes("n");
      const anchorX = isLeft ? base.x + base.w : base.x;
      const anchorY = isTop ? base.y + base.h : base.y;
      const maxW = isLeft ? anchorX : 1 - anchorX;
      const maxH = isTop ? anchorY : 1 - anchorY;
      const wFromX = isLeft ? base.w - dx : base.w + dx;
      const wFromY = (isTop ? base.h - dy : base.h + dy) * ratioNorm;
      const useX = Math.abs(dx) * rect.width >= Math.abs(dy) * rect.height;
      const minW = Math.max(0.02, 36 / rect.width);
      const limit = Math.max(0.01, Math.min(maxW, maxH * ratioNorm));
      const w = clamp(useX ? wFromX : wFromY, Math.min(minW, limit), limit);
      const h = w / ratioNorm;
      setBox({
        x: isLeft ? anchorX - w : anchorX,
        y: isTop ? anchorY - h : anchorY,
        w,
        h,
      });
    };
    const onUp = () => {
      dragRef.current = null;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, []);

  const startDrag = (event: React.PointerEvent, mode: "move" | "resize", handle?: Handle) => {
    if (!box || !imageRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = imageRef.current.getBoundingClientRect();
    dragRef.current = {
      mode,
      handle,
      startX: event.clientX,
      startY: event.clientY,
      box: { ...box },
      rect: { width: rect.width, height: rect.height },
    };
  };

  const chooseRatio = (key: CropPreset["key"]) => {
    const preset = CROP_PRESETS[key];
    const imgW = asset.width || 1;
    const imgH = asset.height || 1;
    const r = preset.width / preset.height;
    let w = 0.9;
    let h = (w * (imgW / imgH)) / r;
    if (h > 0.9) {
      h = 0.9;
      w = (h * r * imgH) / imgW;
    }
    w = Math.min(0.98, w);
    h = Math.min(0.98, (w * (imgW / imgH)) / r);
    setBox({ x: (1 - w) / 2, y: (1 - h) / 2, w, h });
    setRatio(key);
    setSaved(null);
    setError("");
  };

  const save = async () => {
    if (!ratio || !box) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/assets/${asset.id}/crop`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ratio, box }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "裁剪失败");
      setSaved(data as Saved);
    } catch (saveError) {
      setError((saveError as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const reset = () => {
    setRatio(null);
    setBox(null);
    setSaved(null);
    setError("");
  };

  const preset = ratio ? CROP_PRESETS[ratio] : null;
  const handles: { key: Handle; left?: number; right?: number; top?: number; bottom?: number; cursor: string }[] = [
    { key: "nw", left: 0, top: 0, cursor: "nwse-resize" },
    { key: "ne", right: 0, top: 0, cursor: "nesw-resize" },
    { key: "sw", left: 0, bottom: 0, cursor: "nesw-resize" },
    { key: "se", right: 0, bottom: 0, cursor: "nwse-resize" },
  ];

  return (
    <div className="backdrop" onClick={onClose} style={{ zIndex: 70 }}>
      <div
        className="modal"
        style={{ width: saved ? "min(560px,100%)" : ratio ? "min(1120px,100%)" : "min(720px,100%)" }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          <div>
            <b style={{ fontSize: 14 }}>裁剪</b>
            <span className="muted" style={{ fontSize: 12, marginLeft: 8 }}>
              {ratio ? `${preset?.label} · ${preset?.width}×${preset?.height}` : "先选一个比例"}
            </span>
          </div>
          <button className="btn" onClick={onClose}>
            关闭
          </button>
        </div>

        {saved ? (
          <div className="pad" style={{ display: "grid", gap: 12, justifyItems: "center" }}>
            <b style={{ color: "var(--ok)" }}>已存入素材库</b>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={saved.url}
              alt="裁剪结果"
              style={{ maxWidth: "100%", maxHeight: 240, border: "1px solid var(--line)", background: "#faf8f4" }}
            />
            <div className="muted" style={{ fontSize: 12 }}>
              {saved.width}×{saved.height}
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
              <a className="btn" href={`/materials?asset=${saved.id}`}>
                去素材库查看
              </a>
              <button className="btn" onClick={reset}>
                继续裁剪
              </button>
              <button className="btn" onClick={onClose}>
                关闭
              </button>
            </div>
          </div>
        ) : !ratio || !preset ? (
          <div className="pad">
            <p className="muted" style={{ marginTop: 0, fontSize: 12.5 }}>
              选择输出比例，确认后在原图上框选区域；输出尺寸固定为所选规格。
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              {Object.values(CROP_PRESETS).map((item) => (
                <button
                  key={item.key}
                  onClick={() => chooseRatio(item.key)}
                  style={{
                    textAlign: "left",
                    border: "1px solid var(--line)",
                    borderRadius: 12,
                    padding: 14,
                    background: "#fbfaf7",
                  }}
                >
                  <div
                    style={{
                      height: 64,
                      display: "grid",
                      placeItems: "center",
                      background: "#f4f1ea",
                      borderRadius: 8,
                      marginBottom: 10,
                    }}
                  >
                    <div
                      style={{
                        width: "72%",
                        maxWidth: 220,
                        aspectRatio: `${item.width} / ${item.height}`,
                        border: "2px dashed var(--accent)",
                        borderRadius: 4,
                      }}
                    />
                  </div>
                  <b style={{ fontSize: 14 }}>{item.label}</b>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {item.desc}
                  </div>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="modal-body" style={{ gridTemplateColumns: "minmax(0,1fr) 300px" }}>
            <div className="modal-figure" style={{ background: "#1a1916", padding: 18 }}>
              <div
                style={{
                  position: "relative",
                  display: "inline-block",
                  maxWidth: "100%",
                  overflow: "hidden",
                  lineHeight: 0,
                  userSelect: "none",
                  touchAction: "none",
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  ref={imageRef}
                  src={asset.url ?? ""}
                  alt="原图"
                  draggable={false}
                  style={{ maxWidth: "100%", maxHeight: "68vh", display: "block", pointerEvents: "none" }}
                />
                {box && (
                  <div
                    onPointerDown={(event) => startDrag(event, "move")}
                    style={{
                      position: "absolute",
                      left: `${box.x * 100}%`,
                      top: `${box.y * 100}%`,
                      width: `${box.w * 100}%`,
                      height: `${box.h * 100}%`,
                      border: "1.5px solid #fff",
                      boxShadow: "0 0 0 9999px rgba(24,24,24,.62)",
                      boxSizing: "border-box",
                      cursor: "move",
                      touchAction: "none",
                    }}
                  >
                    <div
                      style={{
                        position: "absolute",
                        inset: 0,
                        pointerEvents: "none",
                        opacity: 0.35,
                        backgroundImage:
                          "linear-gradient(to right, transparent 33.1%, #fff 33.1%, #fff 33.6%, transparent 33.6%, transparent 66.1%, #fff 66.1%, #fff 66.6%, transparent 66.6%), linear-gradient(to bottom, transparent 33.1%, #fff 33.1%, #fff 33.6%, transparent 33.6%, transparent 66.1%, #fff 66.1%, #fff 66.6%, transparent 66.6%)",
                      }}
                    />
                    {handles.map((handle) => (
                      <div
                        key={handle.key}
                        onPointerDown={(event) => {
                          event.stopPropagation();
                          startDrag(event, "resize", handle.key);
                        }}
                        style={{
                          position: "absolute",
                          width: 12,
                          height: 12,
                          background: "#fff",
                          border: "1px solid #111",
                          borderRadius: 2,
                          left: handle.left,
                          right: handle.right,
                          top: handle.top,
                          bottom: handle.bottom,
                          cursor: handle.cursor,
                          touchAction: "none",
                        }}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="modal-side">
              <div>
                <h4>裁剪比例</h4>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                  <b style={{ fontSize: 18 }}>{preset.label}</b>
                  <span className="muted" style={{ fontSize: 12 }}>
                    输出 {preset.width}×{preset.height}
                  </span>
                </div>
              </div>

              <p className="muted" style={{ fontSize: 12, lineHeight: 1.7, margin: 0 }}>
                拖动框内移动位置，拖四角缩放；比例锁定，不会变形。框外是深灰蒙版，框内是原图。
              </p>

              <button className="btn" onClick={reset}>
                重选比例
              </button>

              {error && <div style={{ color: "var(--danger)", fontSize: 12.5 }}>{error}</div>}

              <button
                className="btn-primary"
                onClick={() => void save()}
                disabled={saving || !box}
                style={{ marginTop: 4 }}
              >
                {saving ? "裁剪中…" : `确认裁剪 ${preset.width}×${preset.height}`}
              </button>
              <div className="muted" style={{ fontSize: 11.5, lineHeight: 1.6 }}>
                原图不会被修改；成品会存入「素材库」，图库不重复收录。
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
