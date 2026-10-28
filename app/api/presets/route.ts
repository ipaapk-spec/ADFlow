import { NextResponse } from "next/server";
import { createPreset, listPresets } from "@/lib/db";
import { MODELS } from "@/lib/models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ items: listPresets() });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as {
    name?: string;
    model_key?: string;
    aspect_ratio?: string;
    n?: number;
    prompt?: string;
    negative?: string;
  } | null;

  const name = body?.name?.trim();
  if (!name) return NextResponse.json({ error: "预设需要一个名字" }, { status: 400 });
  if (name.length > 30) return NextResponse.json({ error: "名字太长（30 字以内）" }, { status: 400 });

  const modelKey = body?.model_key ?? "fast";
  if (!MODELS[modelKey]) return NextResponse.json({ error: "未知模型" }, { status: 400 });

  const n = [1, 2, 4].includes(Number(body?.n)) ? Number(body?.n) : 1;
  const prompt = (body?.prompt ?? "").slice(0, 4000);

  const preset = createPreset({
    name,
    modelKey,
    aspectRatio: body?.aspect_ratio ?? "1:1",
    n,
    prompt,
    negative: body?.negative?.trim() || null,
  });

  return NextResponse.json({ preset });
}
