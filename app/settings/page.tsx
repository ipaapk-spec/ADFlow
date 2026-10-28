import { allSettings, DATA_DIR, getSetting, statsByModel, statsMonth, statsToday } from "@/lib/db";
import { MODEL_ORDER, MODELS, agnesConfigured, isModelEnabled } from "@/lib/models";
import { VIDEO_MODEL_ORDER, VIDEO_MODELS } from "@/lib/video-models";
import { dataUsage } from "@/lib/storage";
import { SettingsForm } from "@/components/settings-form";

export const dynamic = "force-dynamic";

function mb(bytes: number): string {
  return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

export default async function SettingsPage() {
  const today = statsToday();
  const month = statsMonth();
  const byModel = statsByModel();
  const usage = dataUsage();
  const budget = Number(getSetting("monthly_budget_cny", "50"));
  const usedCny = month.costCny;
  const overBudget = usedCny > budget;

  return (
    <>
      <div className="stage-head">
        <h2 style={{ margin: 0, fontSize: 16 }}>设置</h2>
        <div className="meta">数据目录 {DATA_DIR}</div>
      </div>

      <div className="grid-2">
        <div>
          <SettingsForm
            initial={allSettings()}
            models={MODEL_ORDER.map((key) => MODELS[key]).map((model) => ({
              key: model.key,
              label: model.label,
              enabled: model.enabled,
            }))}
          />

          <div className="panel pad" style={{ marginTop: 16 }}>
            <h3 className="section-title">模型</h3>
            {MODEL_ORDER.map((key) => MODELS[key]).map((model) => (
              <div key={model.key} className="kv">
                <span>
                  <b style={{ color: "var(--ink)" }}>{model.label}</b>
                  <span className="mono" style={{ marginLeft: 8 }}>{(model.endpoints.image ?? model.endpoints.text ?? "").split("/")[0]}</span>
                </span>
                <span>
                  {model.priceCny > 0 ? `¥${model.priceCny.toFixed(2)}/张` : "限免"}{" "}
                  <span className={`badge ${isModelEnabled(model) ? "succeeded" : "queued"}`}>
                    {isModelEnabled(model) ? "启用" : "未配置 / 未开通"}
                  </span>
                </span>
              </div>
            ))}
            <div className="hr" />
            <h3 className="section-title">视频模型</h3>
            {VIDEO_MODEL_ORDER.map((key) => VIDEO_MODELS[key]).map((model) => {
              const free = model.sizes.every(
                (size) => (model.pricePerSecondCny[size] ?? 0) === 0,
              );
              const price = model.pricePerSecondCny[model.sizes[0]] ?? 0;
              return (
                <div key={model.key} className="kv">
                  <span>
                    <b style={{ color: "var(--ink)" }}>{model.label}</b>
                    <span className="mono" style={{ marginLeft: 8 }}>{model.name}</span>
                  </span>
                  <span>
                    {free ? "限免" : `¥${price.toFixed(2)}/秒起`}{" "}
                    <span className={`badge ${agnesConfigured() ? "succeeded" : "queued"}`}>
                      {agnesConfigured() ? "启用" : "未配置"}
                    </span>
                  </span>
                </div>
              );
            })}
            <p className="muted" style={{ fontSize: 11.5, marginBottom: 0 }}>
              改模型请编辑 <code className="mono">lib/models.ts</code> / <code className="mono">lib/video-models.ts</code>；新增前先确认上游不返回 1001。
            </p>
          </div>
        </div>

        <div>
          <div className="panel pad">
            <h3 className="section-title">成本</h3>
            <div className="stat-row">
              <div className="stat">
                <div className="n">¥{usedCny.toFixed(2)}</div>
                <div className="l">本月 · {month.count} 次</div>
              </div>
              <div className="stat">
                <div className="n">¥{today.costCny.toFixed(2)}</div>
                <div className="l">今日 · {today.count} 次</div>
              </div>
            </div>
            <div className="prog" style={{ marginTop: 14 }}>
              <i
                style={{
                  width: `${Math.min(100, budget > 0 ? (usedCny / budget) * 100 : 0)}%`,
                  background: overBudget ? "var(--danger)" : "var(--accent)",
                }}
              />
            </div>
            <div className="row" style={{ marginTop: 6 }}>
              <span>预算 ¥{budget}</span>
              <span>{overBudget ? "已超出预算" : `剩余 ¥${(budget - usedCny).toFixed(2)}`}</span>
            </div>
            <div className="hr" />
            {byModel.length === 0 && <div className="muted" style={{ fontSize: 12 }}>还没有消耗记录</div>}
            {byModel.map((row) => (
              <div key={row.model_key} className="kv">
                <span>
                  {MODELS[row.model_key]?.label ??
                    VIDEO_MODELS[row.model_key]?.label ??
                    row.model_key}
                </span>
                <span>
                  {row.count} {row.model_key.startsWith("video-") ? "条" : "张"} · ¥
                  {row.cost.toFixed(2)}
                </span>
              </div>
            ))}
          </div>

          <div className="panel pad" style={{ marginTop: 16 }}>
            <h3 className="section-title">存储</h3>
            <div className="kv">
              <span>成图</span>
              <span>{mb(usage.images)}</span>
            </div>
            <div className="kv">
              <span>缩略图</span>
              <span>{mb(usage.thumbs)}</span>
            </div>
            <div className="kv">
              <span>上传参考图</span>
              <span>{mb(usage.uploads)}</span>
            </div>
            <div className="kv">
              <span>视频</span>
              <span>{mb(usage.videos)}</span>
            </div>
            <div className="kv">
              <span>数据库</span>
              <span className="mono">{DATA_DIR}/adflow.db</span>
            </div>
            <p className="muted" style={{ fontSize: 11.5, marginBottom: 0 }}>
              备份：<code className="mono">pnpm backup</code> 会把数据库复制到 data/backups（保留 7 份）；图片直接拷 data/images。
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
