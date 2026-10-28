"use client";

import { useState } from "react";
import { Lightbox } from "@/components/lightbox";

export interface AssetCardData {
  id: string;
  url: string;
  thumb: string;
  width: number;
  height: number;
  favorite: number;
  created_at: number;
}

export function AssetCard({
  asset,
  autoOpen = false,
  autoEdit = false,
}: {
  asset: AssetCardData;
  autoOpen?: boolean;
  autoEdit?: boolean;
}) {
  const [favorite, setFavorite] = useState(asset.favorite === 1);
  const [removed, setRemoved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(autoOpen);

  if (removed) return null;

  const toggle = async () => {
    const res = await fetch(`/api/assets/${asset.id}`, { method: "POST" });
    if (res.ok) {
      const data = await res.json();
      setFavorite(Boolean(data.favorite));
    }
  };

  const remove = async () => {
    if (!confirm("移到废纸篓？7 天后清理。")) return;
    setBusy(true);
    const res = await fetch(`/api/assets/${asset.id}`, { method: "DELETE" });
    setBusy(false);
    if (res.ok) setRemoved(true);
  };

  return (
    <figure className="acard" style={{ opacity: busy ? 0.5 : 1 }}>
      <button onClick={() => setOpen(true)} style={{ display: "block", width: "100%", padding: 0 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={asset.thumb}
          alt="生成结果"
          width={asset.width}
          height={asset.height}
          loading="lazy"
          title={`${asset.width}×${asset.height}`}
        />
      </button>
      <div className="tools">
        <button onClick={() => void toggle()} title={favorite ? "取消收藏" : "收藏"}>
          {favorite ? "★" : "♡"}
        </button>
        <a href={asset.url} download={`adflow-${asset.id}.jpg`} title="下载">
          ↓
        </a>
        <button onClick={() => void remove()} title="删除">
          ×
        </button>
      </div>
      <figcaption className="cap">
        <b>{asset.width}×{asset.height}</b>
        <span>{new Date(asset.created_at).toLocaleDateString("zh-CN")}</span>
      </figcaption>
      {open && <Lightbox assetId={asset.id} initialEdit={autoEdit} onClose={() => setOpen(false)} />}
    </figure>
  );
}
