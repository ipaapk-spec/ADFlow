import fsp from "node:fs/promises";
import path from "node:path";

const AGNES_SIZE = "2K";
const REQUEST_TIMEOUT_MS = 300_000;

/** Agnes 只认 1:1 / 3:4 / 4:3 / 16:9 / 9:16 / 2:3 / 3:2 / 21:9，4:5 用最接近的 3:4。 */
const RATIO_MAP: Record<string, string> = {
  "1:1": "1:1",
  "4:5": "3:4",
  "3:4": "3:4",
  "9:16": "9:16",
  "16:9": "16:9",
};

interface AgnesItem {
  url?: string | null;
  b64_json?: string | null;
}

interface AgnesResponse {
  data?: AgnesItem[];
  error?: { message?: string };
  message?: string;
}

function baseUrl(): string {
  const raw = (process.env.AGNES_URL || process.env.AGNES_BASE_URL || "").trim();
  if (!raw) throw new Error("缺少 AGNES_URL（或 AGNES_BASE_URL）");
  const base = raw.replace(/\/+$/, "");
  return /\/v1$/.test(base) ? base : `${base}/v1`;
}

function apiKey(): string {
  const key = (process.env.AGNES_KEY || process.env.AGNES_API_KEY || "").trim();
  if (!key) throw new Error("缺少 AGNES_KEY（或 AGNES_API_KEY）");
  return key;
}

function mimeOf(file: string): string {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  return "image/jpeg";
}

async function toDataUri(file: string): Promise<string> {
  const buffer = await fsp.readFile(file);
  return `data:${mimeOf(file)};base64,${buffer.toString("base64")}`;
}

async function download(url: string): Promise<Buffer> {
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`下载 Agnes 成图失败 HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * 调用 Agnes 图像模型（同步返回，一次一张/一组）。
 * 参考图用 Data URI 传给上游，避免要求公网可访问的本站图片地址。
 */
export async function generateAgnesImages(input: {
  model: string;
  prompt: string;
  aspectRatio: string;
  /** 本地绝对路径；空数组 = 文生图 */
  refs: string[];
}): Promise<Buffer[]> {
  if (!input.model) throw new Error("Agnes 模型名为空");

  const images = await Promise.all(input.refs.map((file) => toDataUri(file)));
  // 直接要 Base64：成图存储域在部分网络环境里下载会超时，省掉二次下载。
  const extraBody: Record<string, unknown> = { response_format: "b64_json" };
  if (images.length > 0) extraBody.image = images;

  const payload = {
    model: input.model,
    prompt: input.prompt,
    size: AGNES_SIZE,
    ratio: RATIO_MAP[input.aspectRatio] ?? "1:1",
    extra_body: extraBody,
  };

  let res: Response;
  try {
    res = await fetch(`${baseUrl()}/images/generations`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      throw new Error("Agnes 响应超时");
    }
    throw error;
  }

  const data = (await res.json().catch(() => null)) as AgnesResponse | null;
  if (!res.ok) {
    const msg = data?.error?.message || data?.message || `HTTP ${res.status}`;
    throw new Error(`Agnes 拒绝：${msg}`);
  }
  const items = data?.data ?? [];
  if (items.length === 0) throw new Error("Agnes 没有返回图片");

  const buffers: Buffer[] = [];
  for (const item of items) {
    if (item.url) buffers.push(await download(item.url));
    else if (item.b64_json) buffers.push(Buffer.from(item.b64_json, "base64"));
  }
  if (buffers.length === 0) throw new Error("Agnes 返回里没有可用图片");
  return buffers;
}

/* ---------------- 视频 ---------------- */

interface AgnesVideoBody {
  video_id?: string;
  status?: string;
  url?: string | null;
  progress?: number;
  message?: string;
  detail?: string;
  code?: string;
  error?: string | { message?: string } | null;
}

export interface AgnesVideoQueryResult {
  status: string;
  url: string | null;
  progress: number;
  error: string | null;
}

function videoError(data: AgnesVideoBody | null, fallback: string): string {
  if (!data) return fallback;
  if (data.code === "video_queue_full") return "视频队列已满，请稍后重试";
  if (typeof data.error === "string") return data.error;
  if (data.error && typeof data.error === "object" && data.error.message) return data.error.message;
  return data.message || data.detail || fallback;
}

/** 创建视频任务，返回轮询用的 video_id。 */
export async function submitAgnesVideo(input: {
  model: string;
  prompt: string;
  seconds: number;
  size: string;
  aspectRatio: string;
  firstFrameUrl?: string | null;
}): Promise<{ videoId: string }> {
  const payload: Record<string, unknown> = {
    model: input.model,
    prompt: input.prompt,
    seconds: String(input.seconds),
    mode: input.firstFrameUrl ? "keyframe" : "text",
    size: input.size,
    aspect_ratio: input.aspectRatio,
    n: 1,
  };
  if (input.firstFrameUrl) payload.first_frame = input.firstFrameUrl;

  const res = await fetch(`${baseUrl()}/videos`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(120_000),
    cache: "no-store",
  });

  const data = (await res.json().catch(() => null)) as AgnesVideoBody | null;
  if (!res.ok) {
    throw new Error(`Agnes 视频：${videoError(data, `HTTP ${res.status}`)}`);
  }
  const videoId = data?.video_id;
  if (!videoId) throw new Error("Agnes 视频没有返回 video_id");
  return { videoId };
}

/** 查询视频任务；status 为 completed 时从 url 取成片。 */
export async function queryAgnesVideo(
  videoId: string,
  model: string,
): Promise<AgnesVideoQueryResult> {
  const url = new URL(`${new URL(baseUrl()).origin}/agnesapi`);
  url.searchParams.set("video_id", videoId);
  url.searchParams.set("model_name", model);

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey()}` },
    signal: AbortSignal.timeout(60_000),
    cache: "no-store",
  });
  const data = (await res.json().catch(() => null)) as AgnesVideoBody | null;
  if (!res.ok) {
    throw new Error(`Agnes 视频查询：${videoError(data, `HTTP ${res.status}`)}`);
  }

  const error =
    typeof data?.error === "string"
      ? data.error
      : data?.error?.message || null;

  return {
    status: String(data?.status ?? "").toLowerCase(),
    url: data?.url ?? null,
    progress: Number(data?.progress ?? 0),
    error,
  };
}
