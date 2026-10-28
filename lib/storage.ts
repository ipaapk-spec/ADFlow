import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { DATA_DIR, IMAGES_DIR, THUMBS_DIR, UPLOADS_DIR, VIDEOS_DIR, TRASH_DIR, uid } from "./db";

/** 返回相对 DATA_DIR 的路径，避免把绝对路径写进数据库。 */
export function relOf(abs: string): string {
  return path.relative(DATA_DIR, abs).split(path.sep).join("/");
}

export function absOf(rel: string): string {
  const abs = path.resolve(DATA_DIR, rel);
  if (!abs.startsWith(path.resolve(DATA_DIR) + path.sep)) {
    throw new Error("非法路径");
  }
  return abs;
}

export function fileUrl(rel: string | null | undefined): string | null {
  if (!rel) return null;
  return `/api/files/${rel}`;
}

function monthFolder(): string {
  const d = new Date();
  const name = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  const dir = path.join(IMAGES_DIR, name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function writeJpeg(
  buffer: Buffer,
  dest: string,
  opts: { maxEdge?: number } = {},
): Promise<{ width: number; height: number }> {
  let pipeline = sharp(buffer, { failOn: "none" }).rotate();
  if (opts.maxEdge) {
    pipeline = pipeline.resize({
      width: opts.maxEdge,
      height: opts.maxEdge,
      fit: "inside",
      withoutEnlargement: true,
    });
  }
  const { width, height } = await pipeline
    .jpeg({ quality: 92, mozjpeg: true })
    .toFile(dest);
  return { width: width ?? 0, height: height ?? 0 };
}

async function makeThumb(srcAbs: string, destAbs: string): Promise<void> {
  await sharp(srcAbs, { failOn: "none" })
    .resize({ width: 640, height: 640, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 78 })
    .toFile(destAbs);
}

export async function saveUpload(buffer: Buffer): Promise<{
  relPath: string;
  width: number;
  height: number;
  bytes: number;
}> {
  const id = uid();
  const dest = path.join(UPLOADS_DIR, `${id}.jpg`);
  const { width, height } = await writeJpeg(buffer, dest, { maxEdge: 2048 });
  const { size } = await fsp.stat(dest);
  return { relPath: relOf(dest), width, height, bytes: size };
}

export async function saveRemoteImage(
  url: string,
  generationId: string,
  index: number,
): Promise<{ relPath: string; thumbRel: string; width: number; height: number; bytes: number }> {
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`下载成图失败 HTTP ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length === 0) throw new Error("下载成图为空");

  const dir = monthFolder();
  const name = `${generationId}-${index}`;
  const dest = path.join(dir, `${name}.jpg`);
  const { width, height } = await writeJpeg(buffer, dest);

  const thumbAbs = path.join(THUMBS_DIR, `${name}.jpg`);
  await makeThumb(dest, thumbAbs);

  const { size } = await fsp.stat(dest);
  return {
    relPath: relOf(dest),
    thumbRel: relOf(thumbAbs),
    width,
    height,
    bytes: size,
  };
}

export async function saveRemoteVideo(
  url: string,
  generationId: string,
): Promise<{ relPath: string; bytes: number }> {
  const res = await fetch(url, { signal: AbortSignal.timeout(180_000) });
  if (!res.ok) throw new Error(`下载视频失败 HTTP ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length === 0) throw new Error("下载视频为空");

  const d = new Date();
  const dir = path.join(VIDEOS_DIR, `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, `${generationId}.mp4`);
  await fsp.writeFile(dest, buffer);
  const { size } = await fsp.stat(dest);
  return { relPath: relOf(dest), bytes: size };
}

export function saveTempBuffer(buffer: Buffer, ext = "jpg"): string {
  const dest = path.join(UPLOADS_DIR, `${uid()}.${ext}`);
  fs.writeFileSync(dest, buffer);
  return relOf(dest);
}

export async function moveToTrash(relPath: string): Promise<void> {
  try {
    const abs = absOf(relPath);
    await fsp.mkdir(TRASH_DIR, { recursive: true });
    await fsp.rename(abs, path.join(TRASH_DIR, `${Date.now()}-${path.basename(abs)}`));
  } catch {
    // 文件可能已不存在，忽略
  }
}

export function dataUsage(): { images: number; thumbs: number; uploads: number; videos: number } {
  const size = (dir: string) => {
    let total = 0;
    const walk = (d: string) => {
      for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, entry.name);
        if (entry.isDirectory()) walk(p);
        else total += fs.statSync(p).size;
      }
    };
    try {
      walk(dir);
    } catch {
      /* ignore */
    }
    return total;
  };
  return {
    images: size(IMAGES_DIR),
    thumbs: size(THUMBS_DIR),
    uploads: size(UPLOADS_DIR),
    videos: size(VIDEOS_DIR),
  };
}

/* ---------------- 局部重绘 ---------------- */

const INPAINT_DIR = path.join(DATA_DIR, "inpaint");
fs.mkdirSync(INPAINT_DIR, { recursive: true });

/** 保存遮罩（保留 alpha），返回相对路径。 */
export function saveMaskPng(buffer: Buffer): string {
  const id = uid();
  const dest = path.join(INPAINT_DIR, `${id}-mask.png`);
  fs.writeFileSync(dest, buffer);
  return relOf(dest);
}

/** 保存中间裁剪图（用于上传给上游）。 */
export async function saveCropJpeg(buffer: Buffer): Promise<string> {
  const id = uid();
  const dest = path.join(INPAINT_DIR, `${id}-crop.jpg`);
  await sharp(buffer).jpeg({ quality: 92 }).toFile(dest);
  return relOf(dest);
}

/** 保存合成后的成图（jpg + 缩略图）。 */
export async function saveProcessedJpeg(
  buffer: Buffer,
): Promise<{ relPath: string; thumbRel: string; width: number; height: number; bytes: number }> {
  const id = uid();
  const dir = monthFolder();
  const dest = path.join(dir, `${id}.jpg`);
  const { width, height } = await sharp(buffer)
    .jpeg({ quality: 92, mozjpeg: true })
    .toFile(dest);
  const thumbAbs = path.join(THUMBS_DIR, `${id}.jpg`);
  await makeThumb(dest, thumbAbs);
  const { size } = await fsp.stat(dest);
  return {
    relPath: relOf(dest),
    thumbRel: relOf(thumbAbs),
    width: width ?? 0,
    height: height ?? 0,
    bytes: size,
  };
}
