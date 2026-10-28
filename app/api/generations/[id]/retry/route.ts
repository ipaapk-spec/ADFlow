import { NextResponse } from "next/server";
import { getGeneration, requeueGeneration } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const generation = getGeneration(id);
  if (!generation) {
    return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  }
  if (!["failed", "timeout"].includes(generation.status)) {
    return NextResponse.json({ error: "只有失败的任务可以重试" }, { status: 400 });
  }
  requeueGeneration(id);
  return NextResponse.json({ ok: true });
}
