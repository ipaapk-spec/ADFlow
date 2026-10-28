"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { MaskEditor } from "@/components/mask-editor";
import { OutpaintPanel } from "@/components/outpaint-panel";
import { CropEditor } from "@/components/crop-editor";

interface Detail {
  asset: {
    id: string;
    url: string | null;
    thumb: string | null;
    width: number;
    height: number;
    bytes: number;
    favorite: number;
    created_at: number;
    generation_id: string;
  };
  base: { id: string; url: string | null } | null;
  generation: {
    id: string;
    mode: string;
    model_key: string;
    model_name?: string;
    prompt: string;
    negative: string | null;
    params: { refs?: string[]; aspect_ratio?: string; seed?: number | null; n?: number };
    created_at: number;
  };
}

const MODE_LABEL: Record<string, string> = {
  text2img: "文生图",
  img2img: "图生图",
  inpaint: "区域重生成",
  outpaint: "扩图",
  crop: "裁剪",
  video: "视频",
};

export function Lightbox({ assetId, onClose, initialEdit = false }: { assetId: string; onClose: () => void; initialEdit?: boolean }) {
  const router = useRouter();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState("");
  const [favorite, setFavorite] = useState(false);
  const [compare, setCompare] = useState(false);
  const [split, setSplit] = useState(50);
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(initialEdit);
  const [outpainting, setOutpainting] = useState(false);
  const [cropping, setCropping] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch(`/api/assets/${assetId}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((data: Detail) => {
        if (!alive) return;
        if (!data.asset) {
          setError("图片不存在或已删除");
          return;
        }
        setDetail(data);
        setFavorite(data.asset.favorite === 1);
        // 默认展示生成结果；需要时再点「对比原图」
        setCompare(false);
      })
      .catch(() => alive && setError("加载失败"));
    return () => {
      alive = false;
    };
  }, [assetId]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const toggleFavorite = useCallback(async () => {
    const res = await fetch(`/api/assets/${assetId}`, { method: "POST" });
    if (res.ok) {
      const data = await res.json();
      setFavorite(Boolean(data.favorite));
    }
  }, [assetId]);

  const remove = useCallback(async () => {
    if (!confirm("移到废纸篓？7 天后清理。")) return;
    const res = await fetch(`/api/assets/${assetId}`, { method: "DELETE" });
    if (res.ok) {
      onClose();
      router.refresh();
    }
  }, [assetId, onClose, router]);

  const copyPrompt = useCallback(async () => {
    if (!detail) return;
    const text = detail.generation.prompt;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        // HTTP 局域网地址不是安全上下文，clipboard API 不可用
        const area = document.createElement("textarea");
        area.value = text;
        area.style.position = "fixed";
        area.style.opacity = "0";
        document.body.appendChild(area);
        area.select();
        document.execCommand("copy");
        document.body.removeChild(area);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setError("复制失败，请手动选中提示词");
    }
  }, [detail]);

  const refUrl = detail?.generation.params.refs?.[0];
  const refSrc = refUrl ? `/api/files/${refUrl}` : (detail?.base?.url ?? null);

  return (
    <div className="backdrop" onClick={onClose}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <b style={{ fontSize: 14 }}>图片详情</b>
            {detail && (
              <span className="muted" style={{ fontSize: 12 }}>
                {detail.generation.model_name ?? detail.generation.model_key} ·{" "}
                {detail.asset.width}×{detail.asset.height}
              </span>
            )}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {refSrc && (
              <button className="btn" onClick={() => setCompare((value) => !value)}>
                {compare ? "看结果" : "对比原图"}
              </button>
            )}
            <button className="btn" onClick={() => setEditing(true)}>
              区域重生成
            </button>
            <button className="btn" onClick={() => setOutpainting(true)}>
              扩图
            </button>
            <button className="btn" onClick={() => setCropping(true)}>
              裁剪
            </button>
            <button className="btn" onClick={onClose}>
              关闭
            </button>
          </div>
        </div>

        {!detail && <div className="pad muted">{error || "加载中…"}</div>}

        {detail && (
          <div className="modal-body">
            <div className="modal-figure">
              {compare && refSrc ? (
                <div className="compare">
                  <div
                    className="layer"
                    style={{ "--ar": `${detail.asset.width} / ${detail.asset.height}` } as React.CSSProperties}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={refSrc} alt="原图" />
                    <div className="after" style={{ clipPath: `inset(0 0 0 ${split}%)` }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={detail.asset.url ?? ""} alt="生成结果" />
                    </div>
                    <span className="compare-badge left">原图</span>
                    <span className="compare-badge right">生成</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={split}
                    onChange={(event) => setSplit(Number(event.target.value))}
                  />
                </div>
              ) : (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={detail.asset.url ?? ""} alt="生成结果" />
              )}
            </div>

            <div className="modal-side">
              <div>
                <h4>提示词</h4>
                <div className="prompt-box">{detail.generation.prompt}</div>
                <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                  <button className="btn" onClick={() => void copyPrompt()}>
                    {copied ? "已复制 ✓" : "复制"}
                  </button>
                  <a
                    className="btn"
                    href={`/create?prompt=${encodeURIComponent(detail.generation.prompt)}&ratio=${encodeURIComponent(detail.generation.params.aspect_ratio ?? "4:5")}&model=${encodeURIComponent(detail.generation.model_key)}`}
                  >
                    用这个思路新建
                  </a>
                </div>
              </div>

              <div>
                <h4>参数</h4>
                <div className="meta-grid">
                  <div>
                    <span>比例</span>
                    <b>{detail.generation.params.aspect_ratio ?? "—"}</b>
                  </div>
                  <div>
                    <span>种子</span>
                    <b>{String(detail.generation.params.seed ?? "随机")}</b>
                  </div>
                  <div>
                    <span>方式</span>
                    <b>{MODE_LABEL[detail.generation.mode] ?? detail.generation.mode}</b>
                  </div>
                  <div>
                    <span>大小</span>
                    <b>{Math.round(detail.asset.bytes / 1024)} KB</b>
                  </div>
                </div>
              </div>

              {error && <div style={{ color: "var(--danger)", fontSize: 12.5 }}>{error}</div>}

              <div style={{ display: "flex", gap: 8, marginTop: "auto", flexWrap: "wrap" }}>
                <a className="btn" href={detail.asset.url ?? "#"} download={`adflow-${detail.asset.id}.jpg`}>
                  ↓ 下载原图
                </a>
                <button className="btn" onClick={() => void toggleFavorite()}>
                  {favorite ? "★ 已收藏" : "♡ 收藏"}
                </button>
                <button className="btn" onClick={() => void remove()} style={{ color: "var(--danger)" }}>
                  删除
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
      {outpainting && detail && (
        <OutpaintPanel
          asset={{ id: detail.asset.id, width: detail.asset.width, height: detail.asset.height }}
          onClose={() => setOutpainting(false)}
        />
      )}
      {editing && detail && (
        <MaskEditor
          asset={{
            id: detail.asset.id,
            url: detail.asset.url,
            width: detail.asset.width,
            height: detail.asset.height,
          }}
          onClose={() => setEditing(false)}
        />
      )}
      {cropping && detail && (
        <CropEditor
          asset={{
            id: detail.asset.id,
            url: detail.asset.url,
            width: detail.asset.width,
            height: detail.asset.height,
          }}
          onClose={() => setCropping(false)}
        />
      )}
    </div>
  );
}
