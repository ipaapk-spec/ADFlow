import { NextResponse } from "next/server";
import { statsByModel, statsMonth, statsToday } from "@/lib/db";

import { startQueue } from "@/lib/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  startQueue();
  const today = statsToday();
  const month = statsMonth();
  return NextResponse.json({
    today: { count: today.count, costCny: Math.round(today.costCny * 1000) / 1000 },
    month: { count: month.count, costCny: Math.round(month.costCny * 1000) / 1000 },
    byModel: statsByModel().map((row) => ({ ...row, costCny: Math.round(row.cost * 1000) / 1000 })),
  });
}
