"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  asset: { id: string; width: number; height: number };
  onClose: () => void;
}

const RATIOS = [
  { key: "1:1", label: "1:1 方图" },
  { key: "4:5", label: "4:5 小红书" },
  { key: "3:4", label: "3:4 竖版" },
  { key: "9:16", label: "9:16 全屏" },
  { key: "16:9", label: "16:9 横版" },
];

function targetSize(width: number, height: number, ratio: string): { width: number; height: number } {
  const [a, b] = ratio.split(":").map(Number);
  const target = a / b;
  return target >= width / height
    ? { width: Math.round(height * target), height }
    : { width, height: Math.round(width / target) };
}

export function OutpaintPanel({ asset, onClose }: Props) {
  const router = useRouter();
  const [ratio, setRatio] = useState("16:9");
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState("fast");
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/models", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        const map: Record<string, number> = {};
        for (const item of data.models as { key: string; priceCny: number }[]) {
          map[item.key] = item.priceCny;
        }
        setPrices(map);
      })
      .catch(() => undefined);
  }, []);

  const target = targetSize(asset.width, asset.height, ratio);

  const submit = async () => {
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/outpaint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assetId: asset.id, ratio, prompt, model }),
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
      <div className="modal" style={{ width: "min(560px,100%)" }} onClick={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <b style={{ fontSize: 14 }}>扩图</b>
          <button className="btn" onClick={onClose}>
            关闭
          </button>
        </div>
        <div className="pad">
          <h4 style={{ margin: "0 0 8px", fontSize: 12, color: "var(--sub)" }}>目标比例</h4>
          <div className="chips">
            {RATIOS.map((item) => (
              <button
                key={item.key}
                className={`chip ${ratio === item.key ? "on" : ""}`}
                onClick={() => setRatio(item.key)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <p className="muted" style={{ fontSize: 12 }}>
            输出 {target.width}×{target.height}
          </p>

          <h4 style={{ margin: "10px 0 8px", fontSize: 12, color: "var(--sub)" }}>补充描述（选填）</h4>
          <textarea
            value={prompt}
            placeholder="留空则用默认：扩展画面，补全四周场景，保持中心主体的光线与材质一致，自然过渡"
            onChange={(event) => setPrompt(event.target.value)}
            style={{ minHeight: 78 }}
          />

          <h4 style={{ margin: "10px 0 8px", fontSize: 12, color: "var(--sub)" }}>档位</h4>
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

          <p className="muted" style={{ fontSize: 11.5, lineHeight: 1.6 }}>
            原理：把原图放到目标尺寸的模糊画布中央交给模型补全四周，再把原图区域贴回来，保证主体不变形。
          </p>

          {error && <div style={{ color: "var(--danger)", fontSize: 12.5 }}>{error}</div>}

          <button className="btn-primary" disabled={submitting} onClick={() => void submit()}>
            {submitting ? "提交中…" : "开始扩图"}
          </button>
        </div>
      </div>
    </div>
  );
}
