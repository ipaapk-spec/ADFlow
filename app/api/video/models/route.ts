import { NextResponse } from "next/server";
import { agnesConfigured } from "@/lib/models";
import { VIDEO_MODEL_ORDER, VIDEO_MODELS, VIDEO_RATIOS } from "@/lib/video-models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const configured = agnesConfigured();
  return NextResponse.json({
    configured,
    ratios: VIDEO_RATIOS,
    models: VIDEO_MODEL_ORDER.map((key) => VIDEO_MODELS[key]).map((model) => ({
      key: model.key,
      name: model.name,
      label: model.label,
      desc: model.desc,
      sizes: model.sizes,
      maxSeconds: model.maxSeconds,
      estSeconds: model.estSeconds,
      pricePerSecondCny: model.pricePerSecondCny,
      enabled: model.enabled && configured,
    })),
  });
}
