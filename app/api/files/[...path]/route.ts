import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import path from "node:path";
import { absOf } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
};

export async function GET(
  req: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path: segments } = await params;
  const rel = segments.join("/");
  let abs: string;
  try {
    abs = absOf(rel);
  } catch {
    return NextResponse.json({ error: "非法路径" }, { status: 400 });
  }

  try {
    const stat = await fs.stat(abs);
    if (!stat.isFile()) return NextResponse.json({ error: "文件不存在" }, { status: 404 });

    const contentType = TYPES[path.extname(abs).toLowerCase()] ?? "application/octet-stream";
    const baseHeaders = {
      "Content-Type": contentType,
      "Accept-Ranges": "bytes",
      "Cache-Control": "public, max-age=31536000, immutable",
    };

    // 视频拖动进度条需要 Range；整文件读取在几十 MB 时也偏重
    const range = req.headers.get("range");
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
      if (match) {
        const size = stat.size;
        let start = match[1] ? Number(match[1]) : 0;
        let end = match[2] ? Number(match[2]) : size - 1;
        // bytes=-N 表示最后 N 字节
        if (!match[1] && match[2]) {
          start = Math.max(0, size - Number(match[2]));
          end = size - 1;
        }
        if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= size) {
          return new NextResponse(null, {
            status: 416,
            headers: { "Content-Range": `bytes */${size}` },
          });
        }
        end = Math.min(end, size - 1);
        const stream = Readable.toWeb(
          createReadStream(abs, { start, end }),
        ) as unknown as ReadableStream;
        return new NextResponse(stream, {
          status: 206,
          headers: {
            ...baseHeaders,
            "Content-Range": `bytes ${start}-${end}/${size}`,
            "Content-Length": String(end - start + 1),
          },
        });
      }
    }

    const data = await fs.readFile(abs);
    return new NextResponse(new Uint8Array(data), {
      headers: {
        ...baseHeaders,
        "Content-Length": String(data.length),
      },
    });
  } catch {
    return NextResponse.json({ error: "文件不存在" }, { status: 404 });
  }
}
