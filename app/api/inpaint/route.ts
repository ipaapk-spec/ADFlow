import { NextResponse } from "next/server";
import sharp from "sharp";
import { createGeneration, getAsset } from "@/lib/db";
import { getModel } from "@/lib/models";
import { maskBBox, padBox } from "@/lib/inpaint";
import { absOf, saveCropJpeg, saveMaskPng } from "@/lib/storage";
import { startQueue } from "@/lib/queue";

export const runtime = "nodejs";

export async function POST(req: Request) {
  startQueue();
  const body = (await req.json().catch(() => null)) as {
    assetId?: string;
    mask?: string;
    prompt?: string;
    model?: string;
  } | null;

  if (!body?.assetId) return NextResponse.json({ error: "缺少 assetId" }, { status: 400 });
  const prompt = (body.prompt ?? "").trim();
  if (!prompt) return NextResponse.json({ error: "写一句想改成什么" }, { status: 400 });

  const asset = getAsset(body.assetId);
  if (!asset) return NextResponse.json({ error: "图片不存在" }, { status: 404 });

  const match = /^data:image\/png;base64,(.+)$/.exec(body.mask ?? "");
  if (!match) return NextResponse.json({ error: "遮罩格式不正确" }, { status: 400 });

  let maskBuffer: Buffer;
  try {
    maskBuffer = Buffer.from(match[1], "base64");
    if (maskBuffer.length > 30 * 1024 * 1024) throw new Error("too large");
  } catch {
    return NextResponse.json({ error: "遮罩数据过大" }, { status: 400 });
  }

  const baseAbs = absOf(asset.path);
  const meta = await sharp(baseAbs).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (!width || !height) return NextResponse.json({ error: "原图尺寸读取失败" }, { status: 500 });

  // 统一到原图尺寸，避免前端 DPR 导致的尺寸漂移
  const normalized = await sharp(maskBuffer)
    .resize(width, height, { fit: "fill" })
    .png()
    .toBuffer();
  const maskRel = saveMaskPng(normalized);

  const bbox = await maskBBox(absOf(maskRel));
  if (!bbox) return NextResponse.json({ error: "先用画刷涂出要改的区域" }, { status: 400 });

  const cropBox = padBox(bbox, width, height);
  const cropBuffer = await sharp(baseAbs)
    .extract({ left: cropBox.x, top: cropBox.y, width: cropBox.width, height: cropBox.height })
    .resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: false })
    .toBuffer();
  const cropRel = await saveCropJpeg(cropBuffer);

  let model;
  try {
    model = getModel(body.model ?? "fast");
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }

  const batchId = crypto.randomUUID();
  const generation = createGeneration({
    mode: "inpaint",
    modelKey: model.key,
    prompt,
    negative: null,
    params: {
      aspect_ratio: cropBox.width >= cropBox.height ? "1:1" : "4:5",
      n: 1,
      seed: null,
      refs: [],
      inpaint: {
        base_asset_id: asset.id,
        mask_rel: maskRel,
        crop_rel: cropRel,
        box: bbox,
        crop_box: cropBox,
      },
    },
    costCny: model.priceCny,
    batchId,
  });

  return NextResponse.json({ id: batchId, ids: [generation.id], estimatedCostCny: model.priceCny });
}
