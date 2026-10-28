import { NextResponse } from "next/server";
import { listGenerations, listAssetsForGeneration } from "@/lib/db";
import { fileUrl } from "@/lib/storage";
import { startQueue } from "@/lib/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  startQueue();
  const url = new URL(req.url);
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") ?? 20)));
  const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0));
  const rows = listGenerations(limit, offset);
  const items = rows.map((row) => {
    const assets = listAssetsForGeneration(row.id);
    return {
      id: row.id,
      status: row.status,
      mode: row.mode,
      model_key: row.model_key,
      prompt: row.prompt,
      cost_cny: row.cost_cny,
      error: row.error,
      created_at: row.created_at,
      finished_at: row.finished_at,
      thumb: assets[0] ? fileUrl(assets[0].thumb_path ?? assets[0].path) : null,
      asset_count: assets.length,
    };
  });
  return NextResponse.json({ items });
}
