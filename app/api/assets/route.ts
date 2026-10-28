import { NextResponse } from "next/server";
import { listAssets } from "@/lib/db";
import { fileUrl } from "@/lib/storage";
import { startQueue } from "@/lib/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  startQueue();
  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim() || undefined;
  const favorite = url.searchParams.get("favorite") === "1";
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") ?? 60)));
  const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0));

  const rows = listAssets({ q, favorite, limit, offset });
  return NextResponse.json({
    items: rows.map((asset) => ({
      id: asset.id,
      generation_id: asset.generation_id,
      url: fileUrl(asset.path),
      thumb: fileUrl(asset.thumb_path ?? asset.path),
      width: asset.width,
      height: asset.height,
      bytes: asset.bytes,
      favorite: asset.favorite,
      created_at: asset.created_at,
    })),
  });
}
