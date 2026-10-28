import { NextResponse } from "next/server";
import sharp from "sharp";
import { addAsset, createGeneration, finishGeneration, getAssetWithGeneration } from "@/lib/db";
import { CROP_PRESETS, isCropRatio } from "@/lib/crop";
import { absOf, fileUrl, saveProcessedJpeg } from "@/lib/storage";

export const runtime = "nodejs";

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as {
    ratio?: string;
    box?: Partial<Box>;
  } | null;

  if (!body?.box || !isCropRatio(body.ratio ?? "")) {
    return NextResponse.json({ error: "缺少裁剪比例或裁剪框" }, { status: 400 });
  }
  const preset = CROP_PRESETS[body.ratio as keyof typeof CROP_PRESETS];
  const box = body.box;
  if (
    ![box.x, box.y, box.w, box.h].every(
      (value) => typeof value === "number" && Number.isFinite(value),
    ) ||
    (box.w as number) <= 0 ||
    (box.h as number) <= 0
  ) {
    return NextResponse.json({ error: "裁剪框参数不合法" }, { status: 400 });
  }

  const found = getAssetWithGeneration(id);
  if (!found) return NextResponse.json({ error: "图片不存在" }, { status: 404 });
  if (found.asset.path.endsWith(".mp4")) {
    return NextResponse.json({ error: "视频不能裁剪" }, { status: 400 });
  }

  const baseAbs = absOf(found.asset.path);
  let width = 0;
  let height = 0;
  try {
    const meta = await sharp(baseAbs).metadata();
    width = meta.width ?? 0;
    height = meta.height ?? 0;
  } catch {
    return NextResponse.json({ error: "图片读取失败" }, { status: 400 });
  }
  if (!width || !height) return NextResponse.json({ error: "图片尺寸读取失败" }, { status: 400 });

  const targetRatio = preset.width / preset.height;
  const left = clamp(Math.round((box.x as number) * width), 0, width - 1);
  const top = clamp(Math.round((box.y as number) * height), 0, height - 1);
  let cropW = clamp(Math.round((box.w as number) * width), 1, width - left);
  let cropH = Math.max(1, Math.round(cropW / targetRatio));

  if (top + cropH > height) {
    cropH = height - top;
    cropW = Math.max(1, Math.round(cropH * targetRatio));
  }
  if (left + cropW > width) {
    cropW = width - left;
    cropH = Math.max(1, Math.round(cropW / targetRatio));
  }
  if (top + cropH > height) {
    cropH = Math.max(1, height - top);
    cropW = Math.max(1, Math.round(cropH * targetRatio));
  }
  if (cropW < 8 || cropH < 8) {
    return NextResponse.json({ error: "裁剪区域太小，请放大裁剪框" }, { status: 400 });
  }

  let buffer: Buffer;
  try {
    buffer = await sharp(baseAbs)
      .extract({ left, top, width: cropW, height: cropH })
      .resize(preset.width, preset.height, { fit: "fill" })
      .jpeg({ quality: 92, mozjpeg: true })
      .toBuffer();
  } catch {
    return NextResponse.json({ error: "裁剪失败，请调整裁剪框后重试" }, { status: 500 });
  }

  const saved = await saveProcessedJpeg(buffer);

  const generation = createGeneration({
    mode: "crop",
    modelKey: found.generation.model_key,
    prompt: `裁剪 ${preset.label}`,
    params: {
      aspect_ratio: preset.label,
      n: 1,
      seed: null,
      refs: [],
      crop: {
        base_asset_id: found.asset.id,
        box: { left, top, width: cropW, height: cropH },
        output: { width: preset.width, height: preset.height },
      },
    },
    costCny: 0,
    batchId: crypto.randomUUID(),
  });
  // 本地裁剪，不能让队列把它当成待提交的上游任务
  finishGeneration(generation.id, "succeeded");

  const asset = addAsset({
    generationId: generation.id,
    filePath: saved.relPath,
    thumbPath: saved.thumbRel,
    width: saved.width,
    height: saved.height,
    bytes: saved.bytes,
    seed: null,
  });

  return NextResponse.json({
    id: asset.id,
    generationId: generation.id,
    url: fileUrl(asset.path),
    width: asset.width,
    height: asset.height,
  });
}
