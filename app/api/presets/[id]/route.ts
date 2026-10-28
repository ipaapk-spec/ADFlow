import { NextResponse } from "next/server";
import { deletePreset } from "@/lib/db";

export const runtime = "nodejs";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  deletePreset(id);
  return NextResponse.json({ ok: true });
}
