import { NextResponse } from "next/server";
import {
  createGeneration,
  getGenerationByClientId,
} from "@/lib/db";
import { ASPECT_RATIOS, getModel } from "@/lib/models";
import { absOf } from "@/lib/storage";
import { startQueue } from "@/lib/queue";

export const runtime = "nodejs";

interface Body {
  model?: string;
  prompt?: string;
  negative?: string;
  aspect_ratio?: string;
  n?: number;
  seed?: number | null;
  strength?: number;
  refs?: string[];
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

  const prompt = (body.prompt ?? "").trim();
  const refs = (body.refs ?? []).filter((r) => typeof r === "string");
  const n = [1, 2, 4].includes(Number(body.n)) ? Number(body.n) : 1;
  const aspect = ASPECT_RATIOS.includes((body.aspect_ratio ?? "") as never)
    ? (body.aspect_ratio as string)
    : "1:1";

  if (!prompt) return NextResponse.json({ error: "提示词不能为空" }, { status: 400 });
  if (prompt.length > 4000) {
    return NextResponse.json({ error: "提示词过长（上限 4000 字）" }, { status: 400 });
  }

  let model;
  try {
    model = getModel(body.model ?? "fast");
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }

  if (refs.length > model.maxRefs) {
    return NextResponse.json(
      { error: `该模型最多支持 ${model.maxRefs} 张参考图` },
      { status: 400 },
    );
  }
  for (const rel of refs) {
    try {
      absOf(rel);
    } catch {
      return NextResponse.json({ error: "参考图路径非法" }, { status: 400 });
    }
  }

  if (body.client_request_id) {
    const existing = getGenerationByClientId(body.client_request_id);
    if (existing) {
      return NextResponse.json({ id: existing.id, estimatedCostCny: existing.cost_cny });
    }
  }

  // 上游一次只出一张，所以 N 张 = N 个任务，共享一个 batch_id
  const batchId = crypto.randomUUID();
  const created = [];
  for (let index = 0; index < n; index += 1) {
    created.push(
      createGeneration({
        mode: refs.length > 0 ? "img2img" : "text2img",
        modelKey: model.key,
        prompt,
        negative: body.negative?.trim() || null,
        params: {
          aspect_ratio: aspect,
          n: 1,
          seed: body.seed ?? null,
          strength: body.strength ?? null,
          refs,
        },
        costCny: model.priceCny,
        clientRequestId: index === 0 ? (body.client_request_id ?? null) : null,
        batchId,
      }),
    );
  }

  return NextResponse.json({
    id: batchId,
    ids: created.map((row) => row.id),
    estimatedCostCny: model.priceCny * n,
  });
}
