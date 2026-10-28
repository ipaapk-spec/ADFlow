import { NextResponse } from "next/server";
import { allSettings, DATA_DIR, setSetting } from "@/lib/db";
import { dataUsage } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULTS: Record<string, string> = {
  monthly_budget_cny: "50",
  default_tier: "fast",
  concurrency: "2",
};

export async function GET() {
  const usage = dataUsage();
  return NextResponse.json({
    settings: { ...DEFAULTS, ...allSettings() },
    dataDir: DATA_DIR,
    usage,
  });
}

export async function PATCH(req: Request) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "请求不是合法 JSON" }, { status: 400 });

  const allowed = ["monthly_budget_cny", "default_tier", "concurrency"];
  for (const key of allowed) {
    if (key in body) {
      const value = String(body[key]).trim();
      if (!value || value.length > 64) {
        return NextResponse.json({ error: `${key} 取值非法` }, { status: 400 });
      }
      if (key === "monthly_budget_cny" && Number.isNaN(Number(value))) {
        return NextResponse.json({ error: `${key} 必须是数字` }, { status: 400 });
      }
      setSetting(key, value);
    }
  }
  return NextResponse.json({ ok: true });
}
