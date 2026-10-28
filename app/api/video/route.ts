import { NextResponse } from "next/server";
import { createGeneration, getGenerationByClientId } from "@/lib/db";
import { agnesConfigured } from "@/lib/models";
import { getVideoModel, VIDEO_RATIOS, videoPriceCny } from "@/lib/video-models";
import { startQueue } from "@/lib/queue";

export const runtime = "nodejs";

interface Body {
  model?: string;
  prompt?: string;
  seconds?: number | string;
  size?: string;
  aspect_ratio?: string;
  first_frame_url?: string;
  client_request_id?: string;
}

export async function POST(req: Request) {
  startQueue();
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "请求不是合法 JSON" }, { status: 400 });
  }

  if (!agnesConfigured()) {
    return NextResponse.json({ error: "缺少 AGNES_URL / AGNES_KEY" }, { status: 400 });
  }

  const prompt = (body.prompt ?? "").trim();
  if (!prompt) return NextResponse.json({ error: "提示词不能为空" }, { status: 400 });
  if (prompt.length > 4000) {
    return NextResponse.json({ error: "提示词过长（上限 4000 字）" }, { status: 400 });
  }

  let model;
  try {
    model = getVideoModel(body.model ?? "video-flash");
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }

  const seconds = Number(body.seconds ?? 5);
  if (!Number.isInteger(seconds) || seconds < 4 || seconds > model.maxSeconds) {
    return NextResponse.json(
      { error: `时长必须是 4–${model.maxSeconds} 秒的整数` },
      { status: 400 },
    );
  }

  const size = model.sizes.includes(body.size ?? "") ? (body.size as string) : model.sizes[0];
  const ratio = (VIDEO_RATIOS as readonly string[]).includes(body.aspect_ratio ?? "")
    ? (body.aspect_ratio as string)
    : "16:9";

  let firstFrameUrl: string | null = null;
  if (body.first_frame_url?.trim()) {
    try {
      const parsed = new URL(body.first_frame_url.trim());
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("protocol");
      firstFrameUrl = parsed.toString();
    } catch {
      return NextResponse.json({ error: "首帧图片必须是公网 http(s) 地址" }, { status: 400 });
    }
  }

  if (body.client_request_id) {
    const existing = getGenerationByClientId(body.client_request_id);
    if (existing) {
      return NextResponse.json({ id: existing.id, estimatedCostCny: existing.cost_cny });
    }
  }

  const batchId = crypto.randomUUID();
  const generation = createGeneration({
    mode: "video",
    modelKey: model.key,
    prompt,
    params: {
      aspect_ratio: ratio,
      seconds,
      size,
      first_frame_url: firstFrameUrl,
      n: 1,
      seed: null,
      refs: [],
    },
    costCny: videoPriceCny(model, size, seconds),
    clientRequestId: body.client_request_id ?? null,
    batchId,
  });

  return NextResponse.json({
    id: batchId,
    ids: [generation.id],
    estimatedCostCny: generation.cost_cny,
  });
}
