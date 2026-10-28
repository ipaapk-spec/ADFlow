"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { requestId } from "@/lib/client-uuid";

interface VideoModelInfo {
  key: string;
  name: string;
  label: string;
  desc: string;
  sizes: string[];
  maxSeconds: number;
  estSeconds: number;
  pricePerSecondCny: Record<string, number>;
  enabled: boolean;
}

export interface HistoryVideo {
  id: string;
  url: string;
  prompt: string;
  model_key: string;
  seconds: number | null;
  size: string | null;
  ratio: string;
  created_at: number;
}

interface BatchAsset {
  id: string;
  url: string;
  width: number;
  height: number;
}

interface VideoBatch {
  id: string;
  status: "queued" | "running" | "succeeded" | "failed" | "timeout";
  error: string | null;
  prompt: string;
  model_key: string;
  cost_cny: number;
  params: { aspect_ratio?: string; seconds?: number; size?: string };
  assets: BatchAsset[];
  progress?: { done: number; total: number };
}

const RATIOS = ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"];
const DURATIONS = [4, 5, 6, 8, 10, 12];

const STATUS_TEXT: Record<string, string> = {
  queued: "排队中",
  running: "生成中",
  succeeded: "完成",
  failed: "失败",
  timeout: "超时",
};

export function VideoClient({ initialVideos }: { initialVideos: HistoryVideo[] }) {
  const search = useSearchParams();

  const [models, setModels] = useState<VideoModelInfo[]>([]);
  const [configured, setConfigured] = useState(true);
  const [modelKey, setModelKey] = useState("video-flash");
  const [ratio, setRatio] = useState("16:9");
  const [seconds, setSeconds] = useState(5);
  const [size, setSize] = useState("720P");
  const [prompt, setPrompt] = useState("");
  const [firstFrameUrl, setFirstFrameUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [genId, setGenId] = useState<string | null>(null);
  const [pollKey, setPollKey] = useState(0);
  const [gen, setGen] = useState<VideoBatch | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState("");
  const [videos, setVideos] = useState<HistoryVideo[]>(initialVideos);

  const activeModel = models.find((item) => item.key === modelKey) ?? models[0];
  const sizes = activeModel?.sizes ?? ["720P"];
  const rate = activeModel?.pricePerSecondCny[size] ?? 0;
  const estimate = rate * seconds;

  useEffect(() => {
    fetch("/api/video/models", { cache: "no-store" })
      .then((res) => res.json())
      .then((data: { configured: boolean; models: VideoModelInfo[] }) => {
        setConfigured(data.configured);
        const enabled = data.models.filter((item) => item.enabled);
        setModels(data.models);
        if (enabled.length > 0) {
          setModelKey((current) =>
            enabled.some((item) => item.key === current) ? current : enabled[0].key,
          );
          setSize((current) => {
            const model = enabled.find((item) => item.key === modelKey) ?? enabled[0];
            return model.sizes.includes(current) ? current : model.sizes[0];
          });
        }
      })
      .catch(() => setError("视频模型加载失败"));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!models.some((item) => item.key === modelKey)) return;
    if (!sizes.includes(size)) setSize(sizes[0]);
  }, [modelKey, models, size, sizes]);

  useEffect(() => {
    const batch = search.get("batch");
    if (batch) {
      setGenId(batch);
      setPollKey((key) => key + 1);
    }
  }, [search]);

  useEffect(() => {
    if (!genId) return;
    let alive = true;
    let timer: ReturnType<typeof setInterval> | null = null;

    const poll = async () => {
      try {
        const res = await fetch(`/api/batches/${genId}`, { cache: "no-store" });
        const data = (await res.json()) as VideoBatch;
        if (!alive) return;
        setGen(data);
        if (["succeeded", "failed", "timeout"].includes(data.status) && timer) {
          clearInterval(timer);
        }
      } catch {
        /* 网络抖动，下一轮继续 */
      }
    };

    poll();
    timer = setInterval(poll, 2000);
    return () => {
      alive = false;
      if (timer) clearInterval(timer);
    };
  }, [genId, pollKey]);

  useEffect(() => {
    if (!gen) return;
    if (gen.params?.aspect_ratio && RATIOS.includes(gen.params.aspect_ratio)) {
      setRatio(gen.params.aspect_ratio);
    }
    if (gen.params?.seconds) setSeconds(gen.params.seconds);
    if (gen.model_key) setModelKey(gen.model_key);
  }, [gen?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (gen && (gen.status === "queued" || gen.status === "running")) {
      setElapsed(0);
      const started = Date.now();
      const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
      return () => clearInterval(timer);
    }
  }, [gen?.id, gen?.status]);

  // 生成成功后把成片插到最近视频
  useEffect(() => {
    if (gen?.status !== "succeeded") return;
    const asset = gen.assets[0];
    if (!asset) return;
    setVideos((prev) => {
      if (prev.some((item) => item.id === asset.id)) return prev;
      return [
        {
          id: asset.id,
          url: asset.url,
          prompt: gen.prompt,
          model_key: gen.model_key,
          seconds: gen.params.seconds ?? seconds,
          size: gen.params.size ?? size,
          ratio: gen.params.aspect_ratio ?? ratio,
          created_at: Date.now(),
        },
        ...prev,
      ];
    });
    setSubmitting(false);
    setError("");
  }, [gen]); // eslint-disable-line react-hooks/exhaustive-deps

  const generate = useCallback(async () => {
    if (!prompt.trim() || submitting) return;
    if (!configured) {
      setError("Agnes 未配置，检查 AGNES_URL / AGNES_KEY");
      return;
    }
    setSubmitting(true);
    setError("");
    setGen(null);
    try {
      const res = await fetch("/api/video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: modelKey,
          prompt,
          seconds,
          size,
          aspect_ratio: ratio,
          first_frame_url: firstFrameUrl.trim() || undefined,
          client_request_id: requestId(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "提交失败");
      setGenId(data.id);
      setPollKey((key) => key + 1);
    } catch (submitError) {
      setError((submitError as Error).message);
    } finally {
      setSubmitting(false);
    }
  }, [prompt, submitting, configured, modelKey, seconds, size, ratio, firstFrameUrl]);

  const removeVideo = useCallback(async (id: string) => {
    if (!window.confirm("删除这个视频？会移到废纸篓。")) return;
    const res = await fetch(`/api/assets/${id}`, { method: "DELETE" });
    if (res.ok) setVideos((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const busy = gen?.status === "queued" || gen?.status === "running";
  const modelLabel = (key: string) =>
    models.find((item) => item.key === key)?.label ??
    (key === "video-flash" ? "视频 Flash" : key === "video-pro" ? "视频 2.5" : key);
  const asset = gen?.status === "succeeded" ? gen.assets[0] : null;
  const meta = gen
    ? `${modelLabel(gen.model_key)} · ${gen.params.size ?? size} · ${gen.params.aspect_ratio ?? ratio} · ${gen.params.seconds ?? seconds}s · ${STATUS_TEXT[gen.status]}${busy ? ` ${elapsed}s` : ""}`
    : activeModel
      ? `${activeModel.label} · ${size} · ${ratio} · ${seconds}s · ${estimate > 0 ? `约 ¥${estimate.toFixed(2)}` : "限免"}`
      : "";

  return (
    <>
      <div className="video-grid">
        <aside className="panel pad">
          <h3 className="section-title">视频模型</h3>
          {models.length === 0 && <div className="muted" style={{ fontSize: 12 }}>加载中…</div>}
          {models
            .filter((item) => item.enabled)
            .map((item) => {
              const free = Object.values(item.pricePerSecondCny).every((value) => value === 0);
              const price = item.pricePerSecondCny[item.sizes[0]] ?? 0;
              return (
                <button
                  key={item.key}
                  className={`tier ${modelKey === item.key ? "on" : ""}`}
                  onClick={() => {
                    setModelKey(item.key);
                    setSize(item.sizes[0]);
                  }}
                  title={item.desc}
                >
                  <span className="l">
                    <span className="dot" />
                    <span>
                      <span className="t">{item.label}</span>
                      <span className="s">{item.name} · 约 {item.estSeconds}s</span>
                    </span>
                  </span>
                  <span className="p">{free ? "限免" : `¥${price.toFixed(2)}/秒`}</span>
                </button>
              );
            })}
          {!configured && (
            <p className="muted" style={{ fontSize: 11.5, color: "var(--danger)" }}>
              服务端缺少 AGNES_URL / AGNES_KEY，视频档位不可用。
            </p>
          )}

          <div className="hr" />
          <h3 className="section-title">比例</h3>
          <div className="chips">
            {RATIOS.map((value) => (
              <button
                key={value}
                className={`chip ${ratio === value ? "on" : ""}`}
                onClick={() => setRatio(value)}
              >
                {value}
              </button>
            ))}
          </div>

          <div className="hr" />
          <h3 className="section-title">时长</h3>
          <div className="chips">
            {DURATIONS.map((value) => (
              <button
                key={value}
                className={`chip ${seconds === value ? "on" : ""}`}
                onClick={() => setSeconds(value)}
              >
                {value}s
              </button>
            ))}
          </div>

          {sizes.length > 1 && (
            <>
              <div className="hr" />
              <h3 className="section-title">清晰度</h3>
              <div className="chips">
                {sizes.map((value) => (
                  <button
                    key={value}
                    className={`chip ${size === value ? "on" : ""}`}
                    onClick={() => setSize(value)}
                  >
                    {value}
                  </button>
                ))}
              </div>
            </>
          )}

          <div className="hr" />
          <h3 className="section-title">提示词</h3>
          <textarea
            value={prompt}
            placeholder="描述主体、动作、镜头运动、光线和氛围，例如：雨后的未来城市街道，霓虹倒映在地面，一辆银色跑车缓慢驶过，电影级运镜…"
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                void generate();
              }
            }}
          />

          <h3 className="section-title" style={{ marginTop: 14 }}>首帧图片 URL（可选）</h3>
          <input
            type="url"
            value={firstFrameUrl}
            placeholder="https://…"
            onChange={(event) => setFirstFrameUrl(event.target.value)}
          />
          <p className="muted" style={{ fontSize: 11.5, margin: "6px 0 0", lineHeight: 1.6 }}>
            填了就走首尾帧模式；图片必须公网可访问，本地上传的参考图 Agnes 读不到。
          </p>

          {error && <div style={{ color: "var(--danger)", fontSize: 12.5, marginTop: 10 }}>{error}</div>}

          <button
            className="btn-primary"
            onClick={() => void generate()}
            disabled={!prompt.trim() || submitting || busy || !configured}
            style={{ marginTop: 14 }}
          >
            {submitting ? "提交中…" : busy ? "生成中…" : `生成 ${seconds}s 视频`}
            <small>{estimate > 0 ? `预计 ¥${estimate.toFixed(2)}` : "限免"}</small>
          </button>
          <div style={{ textAlign: "center", fontSize: 11.5, color: "var(--sub)", marginTop: 8 }}>
            Agnes 异步出片 · 通常 1–3 分钟 · ⌘↵ 快速提交
          </div>
        </aside>

        <section className="panel pad">
          <div className="stage-head">
            <h2>生成结果</h2>
            <div className="meta">{meta}</div>
          </div>

          {!gen && (
            <div className="empty">
              <div style={{ fontSize: 15, color: "var(--ink)", fontWeight: 600, marginBottom: 6 }}>
                想拍一段什么？
              </div>
              <div style={{ fontSize: 12.5 }}>写清主体、动作、镜头和光线，生成会更稳</div>
            </div>
          )}

          {gen && busy && (
            <div className="empty">
              <div style={{ fontSize: 15, color: "var(--ink)", fontWeight: 600, marginBottom: 6 }}>
                视频生成中…
              </div>
              <div style={{ fontSize: 12.5 }}>
                已等待 {elapsed}s · 通常 1–3 分钟{gen.progress ? ` · ${gen.progress.done}/${gen.progress.total}` : ""}
              </div>
            </div>
          )}

          {gen && (gen.status === "failed" || gen.status === "timeout") && (
            <div className="empty" style={{ borderColor: "#e3b3ac" }}>
              <div style={{ color: "var(--danger)", fontWeight: 600, marginBottom: 6 }}>
                {gen.status === "timeout" ? "任务超时" : "生成失败"}
              </div>
              <div style={{ fontSize: 12.5, marginBottom: 12 }}>{gen.error ?? "上游没有返回原因"}</div>
              <button className="btn" onClick={() => void generate()}>
                重试
              </button>
            </div>
          )}

          {gen && gen.status === "succeeded" && asset && (
            <>
              <div className="video-stage">
                <video key={asset.id} src={asset.url} controls playsInline preload="auto" />
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                <button className="btn" onClick={() => void generate()}>
                  ↻ 再来一条
                </button>
                <a className="btn" href={asset.url} download={`adflow-${asset.id}.mp4`}>
                  ↓ 下载视频
                </a>
                <span style={{ fontSize: 12, color: "var(--sub)", alignSelf: "center" }}>
                  花费 ¥{gen.cost_cny.toFixed(2)}
                </span>
              </div>
            </>
          )}
        </section>
      </div>

      <div className="stage-head" style={{ marginTop: 18 }}>
        <h2 style={{ margin: 0, fontSize: 15 }}>最近视频</h2>
        <div className="meta">{videos.length} 条</div>
      </div>

      {videos.length === 0 ? (
        <div className="empty">
          <div style={{ fontSize: 13 }}>还没有视频，先在上面生成一条</div>
        </div>
      ) : (
        <div className="video-history">
          {videos.map((item) => (
            <div className="vcard" key={item.id}>
              <video
                src={`${item.url}#t=0.1`}
                controls
                playsInline
                preload="metadata"
                style={{ "--ar": item.ratio.replace(":", " / ") } as React.CSSProperties}
              />
              <div className="cap">
                <b title={item.prompt}>{item.prompt}</b>
                <span>
                  {modelLabel(item.model_key)} · {item.size} · {item.seconds}s ·{" "}
                  {new Date(item.created_at).toLocaleDateString("zh-CN")}
                </span>
                <div className="vactions">
                  <a href={item.url} download={`adflow-${item.id}.mp4`}>
                    ↓ 下载
                  </a>
                  <button onClick={() => void removeVideo(item.id)}>× 删除</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
