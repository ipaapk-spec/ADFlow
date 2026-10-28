import Link from "next/link";
import { listAssets } from "@/lib/db";
import { fileUrl } from "@/lib/storage";
import { AssetGrid } from "@/components/asset-grid";

export const dynamic = "force-dynamic";

export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; fav?: string; asset?: string; edit?: string }>;
}) {
  const sp = await searchParams;
  const q = sp.q?.trim() || undefined;
  const fav = sp.fav === "1";
  const openAsset = sp.asset;
  const openEdit = sp.edit === "1";
  const assets = listAssets({ q, favorite: fav, limit: 200 });

  return (
    <>
      <div className="stage-head">
        <h2 style={{ margin: 0, fontSize: 16 }}>图库</h2>
        <div className="meta">{assets.length} 张 · 生成图都在这里；裁剪成品在素材库</div>
      </div>

      <div className="filters">
        <form className="search" action="/library" method="get">
          <input
            type="text"
            name="q"
            defaultValue={q ?? ""}
            placeholder="搜索提示词"
          />
          {fav && <input type="hidden" name="fav" value="1" />}
          <button className="btn" type="submit">
            搜索
          </button>
        </form>
        <Link className={`chip ${!fav && !q ? "on" : ""}`} href="/library">
          全部
        </Link>
        <Link className={`chip ${fav ? "on" : ""}`} href="/library?fav=1">
          已赞
        </Link>
        <Link className={`chip ${q ? "on" : ""}`} href="/library?q=%E6%B5%B7%E6%8A%A5">
          海报
        </Link>
        <div style={{ flex: 1 }} />
        <span className="muted" style={{ fontSize: 12 }}>
          {assets.length} 张
        </span>
      </div>

      {assets.length === 0 ? (
        <div className="empty">
          <div style={{ fontSize: 15, color: "var(--ink)", fontWeight: 600, marginBottom: 6 }}>
            这里还空着
          </div>
          <div style={{ fontSize: 12.5, marginBottom: 12 }}>去生成台出第一张图</div>
          <Link className="btn" href="/create">
            去生成
          </Link>
        </div>
      ) : (
        <AssetGrid
          initialOpen={openAsset}
          initialEdit={openEdit}
          assets={assets.map((asset) => ({
            id: asset.id,
            url: fileUrl(asset.path) ?? "",
            thumb: fileUrl(asset.thumb_path ?? asset.path) ?? "",
            width: asset.width,
            height: asset.height,
            favorite: asset.favorite,
            created_at: asset.created_at,
          }))}
        />
      )}
    </>
  );
}
