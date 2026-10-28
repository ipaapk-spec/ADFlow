import { NextResponse } from "next/server";
import { getAsset, getAssetWithGeneration, softDeleteAsset, toggleFavorite } from "@/lib/db";
import { MODELS } from "@/lib/models";
import { fileUrl } from "@/lib/storage";
import { moveToTrash } from "@/lib/storage";

export const runtime = "nodejs";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const asset = toggleFavorite(id);
  if (!asset) return NextResponse.json({ error: "图片不存在" }, { status: 404 });
  return NextResponse.json({ favorite: asset.favorite });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const asset = getAsset(id);
  if (!asset) return NextResponse.json({ error: "图片不存在" }, { status: 404 });
  await moveToTrash(asset.path);
  if (asset.thumb_path) await moveToTrash(asset.thumb_path);
  softDeleteAsset(id);
  return NextResponse.json({ ok: true });
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const found = getAssetWithGeneration(id);
  if (!found) return NextResponse.json({ error: "图片不存在" }, { status: 404 });

  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(found.generation.params);
  } catch {
    /* ignore */
  }

  const inpaint = (parsed as { inpaint?: { base_asset_id?: string } }).inpaint;
  const baseAsset = inpaint?.base_asset_id ? getAsset(inpaint.base_asset_id) : undefined;

  return NextResponse.json({
    base: baseAsset ? { id: baseAsset.id, url: fileUrl(baseAsset.path) } : null,
    asset: {
      id: found.asset.id,
      url: fileUrl(found.asset.path),
      thumb: fileUrl(found.asset.thumb_path ?? found.asset.path),
      width: found.asset.width,
      height: found.asset.height,
      bytes: found.asset.bytes,
      favorite: found.asset.favorite,
      created_at: found.asset.created_at,
      generation_id: found.asset.generation_id,
    },
    generation: {
      id: found.generation.id,
      mode: found.generation.mode,
      model_key: found.generation.model_key,
      model_name: MODELS[found.generation.model_key]?.name ?? found.generation.model_key,
      prompt: found.generation.prompt,
      negative: found.generation.negative,
      params: parsed,
      created_at: found.generation.created_at,
    },
  });
}
