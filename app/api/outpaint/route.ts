import { NextResponse } from "next/server";
import sharp from "sharp";
import { createGeneration, getAsset } from "@/lib/db";
import { getModel } from "@/lib/models";
import { buildPaddedCanvas, targetSize } from "@/lib/outpaint";
import { absOf, saveCropJpeg } from "@/lib/storage";
import { startQueue } from "@/lib/queue";

export const runtime = "nodejs";

const RATIOS = ["1:1", "4:5", "3:4", "9:16", "16:9"];

export async function POST(req: Request) {
  startQueue();
  const body = (await req.json().catch(() => null)) as {
    assetId?: string;
    ratio?: string;
    prompt?: string;
    model?: string;
  } | null;

  if (!body?.assetId) return NextResponse.json({ error: "缺少 assetId" }, { status: 400 });
  const ratio = body.ratio ?? "1:1";
  if (!RATIOS.includes(ratio)) return NextResponse.json({ error: "不支持的扩图比例" }, { status: 400 });

  const asset = getAsset(body.assetId);
  if (!asset) return NextResponse.json({ error: "图片不存在" }, { status: 404 });

  let model;
  try {
    model = getModel(body.model ?? "fast");
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }

  const baseAbs = absOf(asset.path);
  const meta = await sharp(baseAbs).metadata();
  const width = meta.width ?? asset.width;
  const height = meta.height ?? asset.height;
  const target = targetSize(width, height, ratio);

  if (target.width * target.height > 4096 * 4096) {
    return NextResponse.json({ error: "目标尺寸过大" }, { status: 400 });
  }

  const { buffer, placement } = await buildPaddedCanvas(baseAbs, target);
  const paddedRel = await saveCropJpeg(buffer);

  const prompt =
    body.prompt?.trim() ||
    "扩展画面，把四周补全成清晰、真实、有细节的场景，保持中心主体的光线、色调与材质一致，自然衔接，不要模糊、不要虚化、不要边框、不要重复主体";

  const batchId = crypto.randomUUID();
  const generation = createGeneration({
    mode: "outpaint",
    modelKey: model.key,
    prompt,
    negative: null,
    params: {
      aspect_ratio: ratio,
      n: 1,
      seed: null,
      refs: [],
      outpaint: {
        base_asset_id: asset.id,
        padded_rel: paddedRel,
        target,
        placement,
      },
    },
    costCny: model.priceCny,
    batchId,
  });

  return NextResponse.json({
    id: batchId,
    ids: [generation.id],
    estimatedCostCny: model.priceCny,
  });
}
