import { NextResponse } from "next/server";
import { ASPECT_RATIOS, MODEL_ORDER, MODELS, isModelEnabled } from "@/lib/models";
import { getSetting } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    defaultTier: getSetting("default_tier", "fast"),
    aspectRatios: ASPECT_RATIOS,
    models: MODEL_ORDER.map((key) => MODELS[key]).map((model) => ({
      key: model.key,
      label: model.label,
      desc: model.desc,
      priceCny: model.priceCny,
      hasText: Boolean(model.endpoints.text),
      hasImage: Boolean(model.endpoints.image),
      estSeconds: model.estSeconds,
      maxRefs: model.maxRefs,
      enabled: isModelEnabled(model),
    })),
  });
}
