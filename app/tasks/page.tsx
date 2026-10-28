import Link from "next/link";
import { listAssetsForGeneration, listGenerations } from "@/lib/db";
import { MODELS } from "@/lib/models";
import { VIDEO_MODELS } from "@/lib/video-models";
import { promptLabel } from "@/lib/prompt";
import { RetryButton } from "@/components/retry-button";

export const dynamic = "force-dynamic";

const STATUS_TEXT: Record<string, string> = {
  queued: "排队中",
  running: "生成中",
  succeeded: "完成",
  failed: "失败",
  timeout: "超时",
};

function when(ts: number): string {
  return new Date(ts).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function TasksPage() {
  const rows = listGenerations(100);

  return (
    <>
      <div className="stage-head">
        <h2 style={{ margin: 0, fontSize: 16 }}>任务</h2>
        <div className="meta">最近 100 条 · 失败的可以重试</div>
      </div>

      {rows.length === 0 ? (
        <div className="empty">
          <div style={{ marginBottom: 12 }}>还没有任务</div>
          <Link className="btn" href="/create">
            去生成
          </Link>
        </div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 92 }}>时间</th>
              <th>提示词</th>
              <th style={{ width: 90 }}>模型</th>
              <th style={{ width: 70 }}>文件</th>
              <th style={{ width: 80 }}>花费</th>
              <th style={{ width: 90 }}>状态</th>
              <th style={{ width: 90 }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const assets = listAssetsForGeneration(row.id);
              const model = MODELS[row.model_key] ?? VIDEO_MODELS[row.model_key];
              return (
                <tr key={row.id}>
                  <td className="muted">{when(row.created_at)}</td>
                  <td title={row.prompt}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      {row.mode === "inpaint" && <span className="badge running">区域重生成</span>}
                      {row.mode === "outpaint" && <span className="badge running">扩图</span>}
                      {row.mode === "video" && <span className="badge running">视频</span>}
                      {row.mode === "crop" && <span className="badge running">裁剪</span>}
                      <div style={{ maxWidth: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {promptLabel(row.prompt, 80)}
                      </div>
                    </div>
                    {row.error && (
                      <div style={{ color: "var(--danger)", fontSize: 11.5, marginTop: 2 }}>
                        {row.error}
                      </div>
                    )}
                  </td>
                  <td>{model?.label ?? row.model_key}</td>
                  <td>{assets.length}</td>
                  <td>¥{row.cost_cny.toFixed(2)}</td>
                  <td>
                    <span className={`badge ${row.status}`}>{STATUS_TEXT[row.status] ?? row.status}</span>
                  </td>
                  <td>
                    {["failed", "timeout"].includes(row.status) ? (
                      <RetryButton id={row.id} />
                    ) : assets.length > 0 ? (
                      <Link
                        className="btn"
                        href={
                          row.mode === "video"
                            ? `/video?batch=${row.batch_id ?? ""}`
                            : row.mode === "crop" && assets[0]
                              ? `/materials?asset=${assets[0].id}`
                              : `/create?batch=${row.batch_id ?? ""}`
                        }
                      >
                        查看
                      </Link>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </>
  );
}
