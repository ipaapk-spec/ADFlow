import Link from "next/link";
import { listMaterialAssets } from "@/lib/db";
import { fileUrl } from "@/lib/storage";
import { AssetCard } from "@/components/asset-card";

export const dynamic = "force-dynamic";

export default async function MaterialsPage({
  searchParams,
}: {
  searchParams: Promise<{ asset?: string }>;
}) {
  const sp = await searchParams;
  const assets = listMaterialAssets(200);

  return (
    <>
      <div className="stage-head">
        <h2 style={{ margin: 0, fontSize: 16 }}>素材库</h2>
        <div className="meta">{assets.length} 张 · 从图库裁剪生成，按原始比例瀑布流</div>
      </div>

      {assets.length === 0 ? (
        <div className="empty">
          <div style={{ fontSize: 15, color: "var(--ink)", fontWeight: 600, marginBottom: 6 }}>
            这里还空着
          </div>
          <div style={{ fontSize: 12.5, marginBottom: 12 }}>
            去图库打开一张图，点「裁剪」生成 32:5 / 6:5 素材
          </div>
          <Link className="btn" href="/library">
            去图库
          </Link>
        </div>
      ) : (
        <div className="masonry">
          {assets.map((asset) => (
            <AssetCard
              key={asset.id}
              autoOpen={sp.asset === asset.id}
              asset={{
                id: asset.id,
                url: fileUrl(asset.path) ?? "",
                thumb: fileUrl(asset.thumb_path ?? asset.path) ?? "",
                width: asset.width,
                height: asset.height,
                favorite: asset.favorite,
                created_at: asset.created_at,
              }}
            />
          ))}
        </div>
      )}
    </>
  );
}
