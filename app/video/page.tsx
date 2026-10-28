import { Suspense } from "react";
import { listVideoAssets } from "@/lib/db";
import { fileUrl } from "@/lib/storage";
import { VideoClient, type HistoryVideo } from "@/components/video-client";

export const dynamic = "force-dynamic";

export default async function VideoPage() {
  const rows = listVideoAssets(12);
  const initialVideos: HistoryVideo[] = rows.map((row) => {
    let params: { seconds?: number; size?: string; aspect_ratio?: string } = {};
    try {
      params = JSON.parse(row.params) as typeof params;
    } catch {
      /* ignore */
    }
    return {
      id: row.id,
      url: fileUrl(row.path) ?? "",
      prompt: row.prompt,
      model_key: row.model_key,
      seconds: params.seconds ?? null,
      size: params.size ?? null,
      ratio: params.aspect_ratio ?? "16:9",
      created_at: row.created_at,
    };
  });

  return (
    <Suspense fallback={<div className="panel pad muted">加载中…</div>}>
      <VideoClient initialVideos={initialVideos} />
    </Suspense>
  );
}
