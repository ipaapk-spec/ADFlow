import sharp from "sharp";
import fs from "node:fs/promises";

export interface Target {
  width: number;
  height: number;
}

const RATIOS: Record<string, number> = {
  "1:1": 1,
  "4:5": 0.8,
  "3:4": 0.75,
  "9:16": 0.5625,
  "16:9": 1.7778,
};

/** 按目标比例、保持长边不变，算出画布尺寸。 */
export function targetSize(width: number, height: number, ratioKey: string): Target {
  const ratio = RATIOS[ratioKey];
  if (!ratio) throw new Error("不支持的扩图比例");
  // 保持原图一边不变，只往另一边扩，避免把图缩小
  if (ratio >= width / height) {
    return { width: Math.round(height * ratio), height };
  }
  return { width, height: Math.round(width / ratio) };
}

/**
 * 生成给模型看的「画布」：目标尺寸的模糊背景 + 原图居中。
 * 模糊背景比纯色更好地告诉模型「四周大概是什么环境」。
 */
export async function buildPaddedCanvas(
  baseAbs: string,
  target: Target,
): Promise<{ buffer: Buffer; placement: { left: number; top: number; width: number; height: number } }> {
  // 底色先用铺满的模糊图，保证四角不会是纯色
  const bg = await sharp(baseAbs)
    .resize(target.width, target.height, { fit: "cover" })
    .blur(36)
    .modulate({ brightness: 0.9 })
    .toBuffer();

  const inner = await sharp(baseAbs)
    .rotate()
    .resize(target.width, target.height, { fit: "contain" })
    .toBuffer();
  const meta = await sharp(inner).metadata();
  const width = meta.width ?? target.width;
  const height = meta.height ?? target.height;
  const left = Math.round((target.width - width) / 2);
  const top = Math.round((target.height - height) / 2);

  const layers: sharp.OverlayOptions[] = [];

  // 左右 / 上下用镜像条带延展，给模型真实的环境结构（比纯模糊好补全）
  if (left > 0) {
    const strip = await sharp(inner).extract({ left: 0, top: 0, width, height }).flop().toBuffer();
    layers.push({ input: strip, left: 0, top });
    layers.push({ input: await sharp(strip).flop().toBuffer(), left: target.width - left, top });
  }
  if (top > 0) {
    const strip = await sharp(inner).flip().toBuffer();
    layers.push({ input: strip, left, top: 0 });
    layers.push({ input: await sharp(strip).flip().toBuffer(), left, top: target.height - top });
  }

  layers.push({ input: inner, left, top });

  const buffer = await sharp(bg)
    .composite(layers)
    .jpeg({ quality: 92 })
    .toBuffer();

  return { buffer, placement: { left, top, width, height } };
}

/** 生成结果的四周保留模型的补全，中心贴回原图（带羽化边）保证主体不被改坏。 */
export async function mergeOutpaint(input: {
  baseAbs: string;
  generated: Buffer;
  target: Target;
  placement: { left: number; top: number; width: number; height: number };
}): Promise<Buffer> {
  const { baseAbs, generated, target, placement } = input;

  const canvas = await sharp(generated)
    .rotate()
    .resize(target.width, target.height, { fit: "cover" })
    .toBuffer();

  const inner = await sharp(baseAbs).resize(placement.width, placement.height, { fit: "fill" }).toBuffer();

  // 白底 + 黑色描边再模糊，让原图边缘向生成内容自然过渡
  const frame = Math.round(Math.min(placement.width, placement.height) * 0.04) + 10;
  const svg = `<svg width="${placement.width}" height="${placement.height}">
    <rect width="100%" height="100%" fill="white"/>
    <rect x="0" y="0" width="100%" height="100%" fill="none" stroke="black" stroke-width="${frame * 2}"/>
  </svg>`;
  const mask = await sharp(Buffer.from(svg)).blur(frame).toBuffer();

  const patch = await sharp(inner)
    .ensureAlpha()
    .composite([{ input: mask, blend: "dest-in" }])
    .png()
    .toBuffer();

  return sharp(canvas)
    .composite([{ input: patch, left: placement.left, top: placement.top }])
    .jpeg({ quality: 92 })
    .toBuffer();
}

export async function readFileSafe(file: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(file);
  } catch {
    return null;
  }
}
