import { NextResponse } from "next/server";
import { listAssetsForGeneration, listByBatch } from "@/lib/db";
import { startQueue } from "@/lib/queue";
import { fileUrl } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  startQueue();
  const { id } = await params;
  const rows = listByBatch(id);
  if (rows.length === 0) {
    return NextResponse.json({ error: "批次不存在" }, { status: 404 });
  }

  const assets = rows.flatMap((row) =>
    listAssetsForGeneration(row.id).map((asset) => ({
      id: asset.id,
      url: fileUrl(asset.path),
      thumb: fileUrl(asset.thumb_path ?? asset.path),
      width: asset.width,
      height: asset.height,
      favorite: asset.favorite,
    })),
  );

  const running = rows.some((row) => row.status === "queued" || row.status === "running");
  const failed = rows.filter((row) => row.status === "failed" || row.status === "timeout");
  const status = running
    ? "running"
    : failed.length === rows.length
      ? "failed"
      : "succeeded";

  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(rows[0].params);
  } catch {
    /* ignore */
  }

  return NextResponse.json({
    id,
    status,
    error: failed.length > 0 ? failed[0].error : null,
    prompt: rows[0].prompt,
    model_key: rows[0].model_key,
    cost_cny: rows.reduce((sum, row) => sum + row.cost_cny, 0),
    params: { ...parsed, n: rows.length },
    assets,
    progress: {
      done: rows.filter((row) => row.status === "succeeded").length,
      total: rows.length,
    },
  });
}
