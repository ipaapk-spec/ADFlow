"use client";

import { useState } from "react";
import { AssetCard, type AssetCardData } from "@/components/asset-card";
import { Lightbox } from "@/components/lightbox";

/** 瀑布流 + 单个详情：详情里可以按显示顺序左右切换 */
export function AssetGrid({
  assets,
  initialOpen = null,
  initialEdit = false,
}: {
  assets: AssetCardData[];
  initialOpen?: string | null;
  initialEdit?: boolean;
}) {
  const [openId, setOpenId] = useState<string | null>(
    initialOpen && assets.some((asset) => asset.id === initialOpen) ? initialOpen : null,
  );
  // 卡片上删掉的图，别再出现在左右切换里
  const [removed, setRemoved] = useState<string[]>([]);
  const visible = assets.filter((asset) => !removed.includes(asset.id));

  return (
    <>
      <div className="masonry">
        {assets.map((asset) => (
          <AssetCard
            key={asset.id}
            asset={asset}
            onOpen={setOpenId}
            onRemoved={(id) => setRemoved((prev) => [...prev, id])}
          />
        ))}
      </div>
      {openId && (
        <Lightbox
          key={openId}
          assetId={openId}
          siblings={visible.map((asset) => asset.id)}
          initialEdit={initialEdit && openId === initialOpen}
          onClose={() => setOpenId(null)}
        />
      )}
    </>
  );
}
