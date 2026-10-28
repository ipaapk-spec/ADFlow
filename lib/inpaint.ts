import sharp from "sharp";

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 从遮罩 PNG 的 alpha 通道求内容外接框。 */
export async function maskBBox(maskAbs: string): Promise<Box | null> {
  const { data, info } = await sharp(maskAbs)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const channels = info.channels;
  let minX = info.width;
  let minY = info.height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const alpha = data[(y * info.width + x) * channels + 3];
      if (alpha > 12) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < 0) return null;
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/** 在选区外扩一圈上下文，用于给模型看环境。 */
export function padBox(box: Box, imageWidth: number, imageHeight: number): Box {
  const pad = Math.round(Math.max(box.width, box.height) * 0.35);
  const x = Math.max(0, box.x - pad);
  const y = Math.max(0, box.y - pad);
  const right = Math.min(imageWidth, box.x + box.width + pad);
  const bottom = Math.min(imageHeight, box.y + box.height + pad);
  return { x, y, width: right - x, height: bottom - y };
}

/** 把任意比例的框映射到上游支持的比例，取最接近的。 */
export function nearestAspect(width: number, height: number): string {
  const options: [string, number][] = [
    ["1:1", 1],
    ["4:5", 0.8],
    ["3:4", 0.75],
    ["9:16", 0.5625],
    ["16:9", 1.7778],
  ];
  const target = width / height;
  let best = options[0];
  let bestDelta = Infinity;
  for (const option of options) {
    const delta = Math.abs(option[1] - target);
    if (delta < bestDelta) {
      best = option;
      bestDelta = delta;
    }
  }
  return best[0];
}

/**
 * 把生成结果按遮罩羽化贴回原图。
 * generated: 上游返回的该区域图像（比例近似选区）
 * mask: 用户画的遮罩（白色为要重绘）
 */
export async function compositePatch(input: {
  baseAbs: string;
  maskAbs: string;
  generated: Buffer;
  box: Box;
}): Promise<Buffer> {
  const { baseAbs, maskAbs, generated, box } = input;

  const patch = await sharp(generated)
    .rotate()
    .resize(box.width, box.height, { fit: "cover", position: "centre" })
    .png()
    .toBuffer();

  const maskPatch = await sharp(maskAbs)
    .extract({ left: box.x, top: box.y, width: box.width, height: box.height })
    .resize(box.width, box.height, { fit: "fill" })
    .blur(6)
    .png()
    .toBuffer();

  const withAlpha = await sharp(patch)
    .ensureAlpha()
    .composite([{ input: maskPatch, blend: "dest-in" }])
    .png()
    .toBuffer();

  return sharp(baseAbs)
    .rotate()
    .composite([{ input: withAlpha, left: box.x, top: box.y }])
    .jpeg({ quality: 92 })
    .toBuffer();
}
