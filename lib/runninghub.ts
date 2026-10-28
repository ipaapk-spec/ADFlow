const BASE = (
  process.env.RUNNINGHUB_BASE_URL || "https://www.runninghub.ai"
).replace(/\/$/, "");

export interface TaskResult {
  status: "CREATE" | "QUEUED" | "RUNNING" | "SUCCESS" | "FAILED" | string;
  urls: string[];
  error?: string;
}

function apiKey(): string {
  const key = process.env.RUNNINGHUB_API_KEY?.trim();
  if (!key) {
    throw new Error("缺少 RUNNINGHUB_API_KEY，请在 .env 中配置");
  }
  return key;
}

async function postJson(
  endpoint: string,
  payload: Record<string, unknown>,
  timeoutMs = 120_000,
): Promise<Record<string, unknown>> {
  const res = await fetch(`${BASE}/openapi/v2/${endpoint}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`上游 HTTP ${res.status}`);
  }
  const data = (await res.json()) as Record<string, unknown>;
  const code = data.errorCode ?? data.code;
  if (code !== undefined && code !== null && code !== "" && code !== 0 && code !== "0") {
    const msg = (data.msg as string) || (data.message as string) || `错误码 ${code}`;
    throw new Error(`上游拒绝：${msg}`);
  }
  return data;
}

export async function uploadFile(filePath: string, filename: string): Promise<string> {
  const { readFile } = await import("node:fs/promises");
  const bytes = await readFile(filePath);
  const type = filename.toLowerCase().endsWith(".png")
    ? "image/png"
    : filename.toLowerCase().endsWith(".webp")
      ? "image/webp"
      : "image/jpeg";
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(bytes)], { type }), filename);

  const res = await fetch(`${BASE}/openapi/v2/media/upload/binary`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey()}` },
    body: form,
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`上传失败 HTTP ${res.status}`);
  const data = (await res.json()) as {
    data?: { download_url?: string };
    code?: number | string;
  };
  const url = data.data?.download_url;
  if (!url) throw new Error("上传响应缺少 download_url");
  return url;
}

export async function submitTask(
  endpoint: string,
  payload: Record<string, unknown>,
): Promise<string> {
  const data = await postJson(endpoint, payload);
  const taskId = (data.taskId ?? data.task_id) as string | undefined;
  if (!taskId) throw new Error("提交响应缺少 taskId");
  return taskId;
}

export async function queryTask(taskId: string): Promise<TaskResult> {
  const data = await postJson("query", { taskId }, 30_000);
  const status = String(data.status ?? "");
  const results = (data.results ?? []) as { url?: string; outputUrl?: string }[];
  const urls = results
    .map((item) => item.url || item.outputUrl)
    .filter((url): url is string => Boolean(url));
  return { status, urls, error: (data.errorMessage as string) || undefined };
}
