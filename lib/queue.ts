import path from "node:path";
import {
  addAsset,
  countRunning,
  getAsset,
  getSetting,
  db,
  finishGeneration,
  getGeneration,
  listQueued,
  listRunning,
  markPolled,
  markRunning,
  setUpstreamTask,
  type GenerationRow,
} from "./db";
import { getModel } from "./models";
import { getVideoModel } from "./video-models";
import { generateAgnesImages, queryAgnesVideo, submitAgnesVideo } from "./agnes";
import { queryTask, submitTask, uploadFile } from "./runninghub";
import { absOf, saveProcessedJpeg, saveRemoteImage, saveRemoteVideo } from "./storage";
import { compositePatch, nearestAspect } from "./inpaint";
import { mergeOutpaint } from "./outpaint";

const TICK_MS = 2500;
const POLL_MIN_MS = 4000;
const TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_CONCURRENCY = Math.max(1, Number(process.env.ADFLOW_CONCURRENCY ?? 2));

const inFlight = new Set<string>();
let recovered = false;

declare global {
  // eslint-disable-next-line no-var
  var __adflowQueueTimer: ReturnType<typeof setInterval> | undefined;
}

function errText(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === "TimeoutError" || error.name === "AbortError") return "上游响应超时";
    return error.message;
  }
  return String(error);
}

interface InpaintMeta {
  base_asset_id: string;
  mask_rel: string;
  crop_rel: string;
  box: { x: number; y: number; width: number; height: number };
  crop_box: { x: number; y: number; width: number; height: number };
}

interface OutpaintMeta {
  base_asset_id: string;
  padded_rel: string;
  target: { width: number; height: number };
  placement: { left: number; top: number; width: number; height: number };
}

interface GenParams {
  aspect_ratio?: string;
  n?: number;
  seed?: number | null;
  strength?: number;
  refs?: string[];
  seconds?: number;
  size?: string;
  first_frame_url?: string | null;
  mask?: string;
  inpaint?: InpaintMeta;
  outpaint?: OutpaintMeta;
}

function parseParams(gen: GenerationRow): GenParams {
  try {
    return JSON.parse(gen.params) as GenParams;
  } catch {
    return {};
  }
}

function recoverOnce() {
  if (recovered) return;
  recovered = true;
  // 进程重启时，还没拿到上游任务号的直接重新排队。
  db()
    .prepare(
      "UPDATE generations SET status = 'queued', started_at = NULL WHERE status = 'running' AND upstream_task_id IS NULL",
    )
    .run();
}

async function submitOne(gen: GenerationRow): Promise<void> {
  markRunning(gen.id);
  try {
    const params = parseParams(gen);

    // 视频：提交给 Agnes 的视频任务，拿到 videoId 后交给 pollOne 轮询。
    if (gen.mode === "video") {
      const videoModel = getVideoModel(gen.model_key);
      const submitted = await submitAgnesVideo({
        model: videoModel.name,
        prompt: gen.prompt,
        seconds: params.seconds ?? 5,
        size: params.size ?? videoModel.sizes[0],
        aspectRatio: params.aspect_ratio ?? "16:9",
        firstFrameUrl: params.first_frame_url,
      });
      setUpstreamTask(gen.id, submitted.videoId);
      return;
    }

    const model = getModel(gen.model_key);
    const refs = params.refs ?? [];

    // Agnes 是同步接口：这里直接出图并入库，不走 RunningHub 的 taskId / 轮询。
    if (model.provider === "agnes") {
      if (gen.mode === "inpaint" || gen.mode === "outpaint") {
        throw new Error("Agnes 档位暂不支持局部重绘 / 扩图，请换其他档位");
      }
      const buffers = await generateAgnesImages({
        model: model.endpoints.image ?? model.endpoints.text ?? "",
        prompt: gen.prompt,
        aspectRatio: params.aspect_ratio ?? "1:1",
        refs: refs.map((rel) => absOf(rel)),
      });
      for (const buffer of buffers) {
        const saved = await saveProcessedJpeg(buffer);
        addAsset({
          generationId: gen.id,
          filePath: saved.relPath,
          thumbPath: saved.thumbRel,
          width: saved.width,
          height: saved.height,
          bytes: saved.bytes,
          seed: params.seed ?? null,
        });
      }
      finishGeneration(gen.id, "succeeded");
      return;
    }

    const imageUrls: string[] = [];
    for (const [index, rel] of refs.entries()) {
      const abs = absOf(rel);
      imageUrls.push(await uploadFile(abs, `ref-${index + 1}${path.extname(abs) || ".jpg"}`));
    }

    let payload: Record<string, unknown>;

    if (gen.mode === "inpaint" && params.inpaint) {
      const cropUrl = await uploadFile(absOf(params.inpaint.crop_rel), "crop.jpg");
      payload = {
        imageUrls: [cropUrl],
        prompt: `${gen.prompt}。保持周围的光线、色调、材质与景深一致，自然衔接，不要出现边框或拼接痕迹。`,
        aspectRatio: nearestAspect(params.inpaint.box.width, params.inpaint.box.height),
      };
    } else if (gen.mode === "outpaint" && params.outpaint) {
      const paddedUrl = await uploadFile(absOf(params.outpaint.padded_rel), "canvas.jpg");
      payload = {
        imageUrls: [paddedUrl],
        prompt: gen.prompt,
        aspectRatio: nearestAspect(params.outpaint.target.width, params.outpaint.target.height),
      };
    } else {
      payload = {
        prompt: gen.prompt,
        aspectRatio: params.aspect_ratio ?? "1:1",
      };
      if (imageUrls.length > 0) payload.imageUrls = imageUrls;
      if (params.seed) payload.seed = params.seed;
      if (params.n && params.n > 1) payload.numImages = params.n;
    }

    const wantsImage = gen.mode === "inpaint" || gen.mode === "outpaint" || imageUrls.length > 0;
    const endpoint = wantsImage ? model.endpoints.image : model.endpoints.text;
    if (!endpoint) {
      throw new Error(`模型「${model.label}」不支持${wantsImage ? "图生图" : "文生图"}`);
    }
    const taskId = await submitTask(endpoint, payload);
    setUpstreamTask(gen.id, taskId);
  } catch (error) {
    finishGeneration(gen.id, "failed", errText(error));
  }
}

async function pollOne(gen: GenerationRow): Promise<void> {
  if (!gen.upstream_task_id) return;
  markPolled(gen.id);

  if (gen.started_at && Date.now() - gen.started_at > TIMEOUT_MS) {
    finishGeneration(gen.id, "timeout", "超过 30 分钟未完成");
    return;
  }

  try {
    // 视频任务走 Agnes 的 /agnesapi 查询，完成后下载 mp4 入库。
    if (gen.mode === "video") {
      const videoModel = getVideoModel(gen.model_key);
      const result = await queryAgnesVideo(gen.upstream_task_id, videoModel.name);
      if (result.status === "completed") {
        if (!result.url) throw new Error("Agnes 视频完成但未返回地址");
        let saved: Awaited<ReturnType<typeof saveRemoteVideo>> | null = null;
        let lastError: unknown = null;
        for (let attempt = 0; attempt < 3 && !saved; attempt += 1) {
          try {
            saved = await saveRemoteVideo(result.url, gen.id);
          } catch (error) {
            lastError = error;
            await new Promise((resolve) => setTimeout(resolve, 2000 * (attempt + 1)));
          }
        }
        if (!saved) {
          finishGeneration(gen.id, "failed", `下载视频失败：${errText(lastError)}`);
          return;
        }
        addAsset({
          generationId: gen.id,
          filePath: saved.relPath,
          thumbPath: null,
          width: 0,
          height: 0,
          bytes: saved.bytes,
          seed: null,
        });
        finishGeneration(gen.id, "succeeded");
        return;
      }
      if (result.status === "failed") {
        finishGeneration(gen.id, "failed", result.error || "视频生成失败");
        return;
      }
      return;
    }

    const result = await queryTask(gen.upstream_task_id);
    if (result.status === "SUCCESS") {
      if (result.urls.length === 0) throw new Error("任务成功但未返回图片");
      const params = parseParams(gen);

      // 扩图：保留模型补全的四周，中心贴回原图
      if (gen.mode === "outpaint" && params.outpaint) {
        const base = getAsset(params.outpaint.base_asset_id);
        if (!base) throw new Error("原图已被删除，无法合成");
        const response = await fetch(result.urls[0], { signal: AbortSignal.timeout(120_000) });
        if (!response.ok) throw new Error("下载生成结果失败");
        const generated = Buffer.from(await response.arrayBuffer());
        const merged = await mergeOutpaint({
          baseAbs: absOf(base.path),
          generated,
          target: params.outpaint.target,
          placement: params.outpaint.placement,
        });
        const saved = await saveProcessedJpeg(merged);
        addAsset({
          generationId: gen.id,
          filePath: saved.relPath,
          thumbPath: saved.thumbRel,
          width: saved.width,
          height: saved.height,
          bytes: saved.bytes,
          seed: null,
        });
        finishGeneration(gen.id, "succeeded");
        return;
      }

      // 局部重绘：把生成的小图羽化贴回原图
      if (gen.mode === "inpaint" && params.inpaint) {
        const base = getAsset(params.inpaint.base_asset_id);
        if (!base) throw new Error("原图已被删除，无法合成");
        const response = await fetch(result.urls[0], { signal: AbortSignal.timeout(120_000) });
        if (!response.ok) throw new Error("下载生成结果失败");
        const generated = Buffer.from(await response.arrayBuffer());
        const merged = await compositePatch({
          baseAbs: absOf(base.path),
          maskAbs: absOf(params.inpaint.mask_rel),
          generated,
          box: params.inpaint.box,
        });
        const saved = await saveProcessedJpeg(merged);
        addAsset({
          generationId: gen.id,
          filePath: saved.relPath,
          thumbPath: saved.thumbRel,
          width: saved.width,
          height: saved.height,
          bytes: saved.bytes,
          seed: null,
        });
        finishGeneration(gen.id, "succeeded");
        return;
      }

      for (const [index, url] of result.urls.entries()) {
        const saved = await saveRemoteImage(url, gen.id, index + 1);
        addAsset({
          generationId: gen.id,
          filePath: saved.relPath,
          thumbPath: saved.thumbRel,
          width: saved.width,
          height: saved.height,
          bytes: saved.bytes,
          seed: params.seed ?? null,
        });
      }
      finishGeneration(gen.id, "succeeded");
      return;
    }
    if (result.status === "FAILED") {
      finishGeneration(gen.id, "failed", result.error || "上游返回失败");
      return;
    }
    // CREATE / QUEUED / RUNNING：继续等
  } catch {
    // 网络抖动不算失败，下一轮继续
  }
}

async function tick(): Promise<void> {
  recoverOnce();
  const running = listRunning();

  // 清理已经没有上游任务号、又卡在 running 的脏数据
  for (const gen of running) {
    if (!gen.upstream_task_id && !inFlight.has(gen.id)) {
      finishGeneration(gen.id, "failed", "任务丢失，请重试");
    }
  }

  const live = listRunning();
  const configured = Number(getSetting("concurrency", String(DEFAULT_CONCURRENCY)));
  const concurrency = Number.isFinite(configured) && configured > 0 ? Math.min(4, Math.floor(configured)) : DEFAULT_CONCURRENCY;
  const slots = Math.max(0, concurrency - countRunning());
  if (slots > 0) {
    for (const gen of listQueued(slots)) {
      if (inFlight.has(gen.id) || getGeneration(gen.id)?.status !== "queued") continue;
      inFlight.add(gen.id);
      void submitOne(gen).finally(() => inFlight.delete(gen.id));
    }
  }

  for (const gen of live) {
    if (!gen.upstream_task_id) continue;
    if (inFlight.has(gen.id)) continue;
    if (Date.now() - (gen.last_polled_at ?? 0) < POLL_MIN_MS) continue;
    inFlight.add(gen.id);
    void pollOne(gen).finally(() => inFlight.delete(gen.id));
  }
}

export function startQueue(): void {
  if (globalThis.__adflowQueueTimer) return;
  globalThis.__adflowQueueTimer = setInterval(() => {
    void tick().catch(() => undefined);
  }, TICK_MS);
  void tick().catch(() => undefined);
}
