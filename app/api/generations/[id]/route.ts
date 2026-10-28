import { NextResponse } from "next/server";
import { getGeneration, listAssetsForGeneration } from "@/lib/db";
import { fileUrl } from "@/lib/storage";
import { startQueue } from "@/lib/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  startQueue();
  const { id } = await params;
  const generation = getGeneration(id);
  if (!generation) {
    return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  }
  const assets = listAssetsForGeneration(id).map((asset) => ({
    id: asset.id,
    url: fileUrl(asset.path),
    thumb: fileUrl(asset.thumb_path ?? asset.path),
    width: asset.width,
    height: asset.height,
    bytes: asset.bytes,
    favorite: asset.favorite,
    created_at: asset.created_at,
  }));
  let parsedParams: Record<string, unknown> = {};
  try {
    parsedParams = JSON.parse(generation.params);
  } catch {
    /* ignore */
  }
  return NextResponse.json({
    id: generation.id,
    status: generation.status,
    error: generation.error,
    prompt: generation.prompt,
    model_key: generation.model_key,
    cost_cny: generation.cost_cny,
    created_at: generation.created_at,
    started_at: generation.started_at,
    finished_at: generation.finished_at,
    params: parsedParams,
    assets,
  });
}
