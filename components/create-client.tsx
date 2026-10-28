"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Lightbox } from "@/components/lightbox";
import { LikeButton } from "@/components/like-button";
import { requestId } from "@/lib/client-uuid";
import { hasPromptPlaceholders, promptLabel } from "@/lib/prompt";

interface ModelInfo {
  key: string;
  label: string;
  desc: string;
  priceCny: number;
  estSeconds: number;
  maxRefs: number;
  enabled: boolean;
  hasText: boolean;
  hasImage: boolean;
}

interface AssetInfo {
  id: string;
  url: string;
  thumb: string;
  width: number;
  height: number;
  favorite: number;
}

interface GenState {
  id: string;
  status: "queued" | "running" | "succeeded" | "failed" | "timeout";
  error: string | null;
  prompt: string;
  model_key: string;
  cost_cny: number;
  params: { aspect_ratio?: string; n?: number; seed?: number | null };
  assets: AssetInfo[];
  progress?: { done: number; total: number };
}

interface PresetItem {
  id: string;
  name: string;
  model_key: string;
  aspect_ratio: string;
  n: number;
  negative: string | null;
  prompt_prefix: string | null;
}

interface QueueItem {
  id: string;
  status: string;
  prompt: string;
  model_key: string;
  thumb: string | null;
  created_at: number;
  error: string | null;
}

const EXAMPLES = [
  {
    label: "大胆排版海报",
    prompt:
      "4:5 垂直高级海报，纯色高饱和背景，超大粗体排版被激进裁切，产品居中且与文字重叠，写实冷凝水与冰块，极强的视觉层级，高级印刷广告质感，不要漂浮元素",
  },
  {
    label: "电商白底主图",
    prompt:
      "电商主图：纯白背景，产品居中，柔和影棚光，轻微投影，画面干净，8K 产品摄影，真实材质与细节，无多余装饰",
  },
  {
    label: "电影感产品场景",
    prompt:
      "产品置于真实使用场景，自然侧逆光，浅景深，背景虚化但有环境信息，电影感调色，画面高级克制，写实材质",
  },
];

const STATUS_TEXT: Record<string, string> = {
  queued: "排队中",
  running: "生成中",
  succeeded: "完成",
  failed: "失败",
  timeout: "超时",
};

export function CreateClient() {
  const search = useSearchParams();

  const [models, setModels] = useState<ModelInfo[]>([]);
  const [tier, setTier] = useState("agnes");
  const [ratio, setRatio] = useState("4:5");
  const [n, setN] = useState(1);
  const [prompt, setPrompt] = useState("");
  const [negative, setNegative] = useState("");
  const [showNegative, setShowNegative] = useState(false);
  const [randomSeed, setRandomSeed] = useState(true);
  const [seed, setSeed] = useState("");
  const [refs, setRefs] = useState<{ path: string; url: string }[]>([]);
  const [mode, setMode] = useState<"text" | "image">("text");
  const [dragging, setDragging] = useState(false);

  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [genId, setGenId] = useState<string | null>(null);
  const [pollKey, setPollKey] = useState(0);
  const [gen, setGen] = useState<GenState | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [presets, setPresets] = useState<PresetItem[]>([]);
  const [activePreset, setActivePreset] = useState<string | null>(null);
  const [selectedAsset, setSelectedAsset] = useState<string | null>(null);
  const [error, setError] = useState("");

  const fileInput = useRef<HTMLInputElement>(null);
  const prefilled = useRef(false);

  const wantsImage = mode === "image";
  const availableModels = models
    .filter((m) => (wantsImage ? m.hasImage : m.hasText))
    .sort(
      (a, b) =>
        a.priceCny - b.priceCny ||
        a.estSeconds - b.estSeconds ||
        a.label.localeCompare(b.label, "zh-CN"),
    );
  const activeModel = availableModels.find((m) => m.key === tier) ?? availableModels[0];

  // 切换文生/图生或模型能力变化时，把档位修正到可用模型
  useEffect(() => {
    if (availableModels.length > 0 && !availableModels.some((m) => m.key === tier)) {
      setTier(availableModels[0].key);
    }
  }, [availableModels, tier]);
  const estimate = activeModel ? activeModel.priceCny * n : 0;

  /* ---------- 初始化 ---------- */
  useEffect(() => {
    fetch("/api/models", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        const enabled = (data.models as ModelInfo[]).filter((m) => m.enabled);
        setModels(data.models as ModelInfo[]);
        if (enabled.length > 0) {
          const preferred = data.defaultTier as string | undefined;
          setTier((current) =>
            enabled.some((m) => m.key === current)
              ? current
              : enabled.some((m) => m.key === preferred)
                ? (preferred as string)
                : enabled[0].key,
          );
        }
      })
      .catch(() => setError("模型列表加载失败"));
  }, []);

  useEffect(() => {
    const batch = search.get("batch");
    if (batch) {
      setGenId(batch);
      setPollKey((key) => key + 1);
    }
  }, [search]);

  useEffect(() => {
    if (prefilled.current) return;
    const p = search.get("prompt");
    const r = search.get("ratio");
    const m = search.get("model");
    const modeParam = search.get("mode");
    if (modeParam === "image") setMode("image");
    if (p) setPrompt(p);
    if (r) setRatio(r);
    if (m) setTier(m);
    if (p) prefilled.current = true;
  }, [search]);

  const loadPresets = useCallback(() => {
    fetch("/api/presets", { cache: "no-store" })
      .then((res) => res.json())
      .then((data: { items: PresetItem[] }) => setPresets(data.items))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    loadPresets();
  }, [loadPresets]);

  const applyPreset = useCallback((preset: PresetItem) => {
    setTier(preset.model_key);
    setRatio(preset.aspect_ratio);
    setN([1, 2, 4].includes(preset.n) ? preset.n : 1);
    setPrompt(preset.prompt_prefix ?? "");
    setNegative(preset.negative ?? "");
    setActivePreset(preset.id);
  }, []);

  const savePreset = useCallback(async () => {
    const name = window.prompt("给这个预设起个名字（模型 / 比例 / 数量 / 提示词会一起存）");
    if (!name?.trim()) return;
    const res = await fetch("/api/presets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        model_key: tier,
        aspect_ratio: ratio,
        n,
        prompt,
        negative: showNegative ? negative : "",
      }),
    });
    if (res.ok) loadPresets();
  }, [tier, ratio, n, prompt, showNegative, negative, loadPresets]);

  const removePreset = useCallback(async (id: string) => {
    await fetch(`/api/presets/${id}`, { method: "DELETE" });
    setActivePreset((current) => (current === id ? null : current));
    loadPresets();
  }, [loadPresets]);

  const loadQueue = useCallback(() => {
    fetch("/api/generations?limit=6", { cache: "no-store" })
      .then((res) => res.json())
      .then((data: { items: QueueItem[] }) => setQueue(data.items))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    loadQueue();
    const timer = setInterval(loadQueue, 6000);
    return () => clearInterval(timer);
  }, [loadQueue]);

  /* ---------- 轮询当前任务 ---------- */
  useEffect(() => {
    if (!genId) return;
    let alive = true;
    let timer: ReturnType<typeof setInterval> | null = null;

    const poll = async () => {
      try {
        const res = await fetch(`/api/batches/${genId}`, { cache: "no-store" });
        const data = (await res.json()) as GenState & { error?: string };
        if (!alive) return;
        setGen(data);
        if (["succeeded", "failed"].includes(data.status) && timer) {
          clearInterval(timer);
          loadQueue();
        }
      } catch {
        /* 网络抖动忽略，下轮继续 */
      }
    };

    poll();
    timer = setInterval(poll, 1500);
    return () => {
      alive = false;
      if (timer) clearInterval(timer);
    };
  }, [genId, pollKey, loadQueue]);

  useEffect(() => {
    if (!gen) return;
    if (gen.params?.aspect_ratio) setRatio(gen.params.aspect_ratio);
    if (gen.params?.n && [1, 2, 4].includes(gen.params.n)) setN(gen.params.n);
    if (gen.model_key) setTier(gen.model_key);
  }, [gen?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (gen && (gen.status === "running" || gen.status === "queued")) {
      setElapsed(0);
      const started = Date.now();
      const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
      return () => clearInterval(timer);
    }
  }, [gen?.id, gen?.status]);

  /* ---------- 上传 ---------- */
  const uploadFiles = useCallback(async (files: File[]) => {
    const images = files.filter((file) => file.type.startsWith("image/"));
    if (images.length === 0) return;
    setUploading(true);
    setError("");
    try {
      for (const file of images.slice(0, 3)) {
        const form = new FormData();
        form.append("file", file);
        const res = await fetch("/api/upload", { method: "POST", body: form });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "上传失败");
        setRefs((prev) =>
          prev.length >= 3
            ? prev
            : [...prev, { path: data.relPath, url: `/api/files/${data.relPath}` }],
        );
      }
    } catch (uploadError) {
      setError((uploadError as Error).message);
    } finally {
      setUploading(false);
    }
  }, []);

  // 图生图模式下支持直接粘贴截图
  useEffect(() => {
    if (mode !== "image") return;
    const onPaste = (event: ClipboardEvent) => {
      const files = Array.from(event.clipboardData?.files ?? []);
      if (files.length > 0) void uploadFiles(files);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [mode, uploadFiles]);

  /* ---------- 生成 ---------- */
  const generate = useCallback(async () => {
    if (!prompt.trim() || submitting) return;
    if (mode === "image" && refs.length === 0) {
      setError("图生图需要先选择一张参考图");
      return;
    }
    setSubmitting(true);
    setError("");
    setGen(null);
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: tier,
          prompt,
          negative: showNegative ? negative : "",
          aspect_ratio: ratio,
          n,
          seed: randomSeed ? null : Number(seed) || null,
          refs: mode === "image" ? refs.map((ref) => ref.path) : [],
          client_request_id: requestId(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "提交失败");
      setGenId(data.id);
      setPollKey((key) => key + 1);
      setTimeout(loadQueue, 500);
    } catch (submitError) {
      setError((submitError as Error).message);
      setSubmitting(false);
    } finally {
      setSubmitting(false);
    }
  }, [prompt, submitting, tier, showNegative, negative, ratio, n, randomSeed, seed, refs, mode, loadQueue]);

  const retry = useCallback(async () => {
    if (!gen) return;
    await fetch(`/api/generations/${gen.id}/retry`, { method: "POST" });
    setPollKey((key) => key + 1);
  }, [gen]);

  const toggleFavorite = useCallback(async (asset: AssetInfo) => {
    const res = await fetch(`/api/assets/${asset.id}`, { method: "POST" });
    const data = await res.json();
    if (res.ok) {
      setGen((prev) =>
        prev
          ? {
              ...prev,
              assets: prev.assets.map((item) =>
                item.id === asset.id ? { ...item, favorite: data.favorite } : item,
              ),
            }
          : prev,
      );
    }
  }, []);

  const busy = gen?.status === "queued" || gen?.status === "running";
  const slots = gen ? (gen.params?.n ?? n) : n;

  return (
    <div className="create-grid">
      {/* ---------------- 参数 ---------------- */}
      <aside className="panel pad">
        <h3 className="section-title">模式</h3>
        <div className="seg">
          <button
            className={mode === "text" ? "on" : ""}
            onClick={() => {
              setMode("text");
              // 切回文生图时不弹文件框，参考图保留着，切回来还能用
            }}
          >
            文生图
          </button>
          <button
            className={mode === "image" ? "on" : ""}
            onClick={() => setMode("image")}
          >
            图生图
          </button>
        </div>

        <div className="hr" />
        <h3 className="section-title">预设</h3>
        <div className="chips">
          {presets.map((preset) => (
            <span
              key={preset.id}
              className={`chip ${activePreset === preset.id ? "on" : ""}`}
              style={{ display: "inline-flex", alignItems: "center", gap: 4, paddingRight: 6 }}
            >
              <button onClick={() => applyPreset(preset)} title={preset.prompt_prefix ?? ""}>
                {preset.name}
              </button>
              <button
                onClick={() => void removePreset(preset.id)}
                title="删除预设"
                style={{ opacity: 0.45, fontSize: 12 }}
              >
                ×
              </button>
            </span>
          ))}
          <button className="chip" onClick={() => void savePreset()}>
            ＋ 存为预设
          </button>
        </div>

        <div className="hr" />
        <h3 className="section-title">模型档位</h3>
        {availableModels
          .map((model) => (
            <button
              key={model.key}
              className={`tier ${tier === model.key ? "on" : ""}`}
              onClick={() => setTier(model.key)}
              title={model.desc}
            >
              <span className="l">
                <span className="dot" />
                <span>
                  <span className="t">{model.label}</span>
                  <span className="s">
                    {model.desc.split("·")[0].trim()} · 约 {model.estSeconds}s
                  </span>
                </span>
              </span>
              <span className="p">{model.priceCny > 0 ? `¥${model.priceCny.toFixed(2)}/张` : "限免"}</span>
            </button>
          ))}

        <div className="hr" />
        <h3 className="section-title">比例</h3>
        <div className="chips">
          {["1:1", "4:5", "3:4", "9:16", "16:9"].map((value) => (
            <button
              key={value}
              className={`chip ${ratio === value ? "on" : ""}`}
              onClick={() => setRatio(value)}
            >
              {value}
            </button>
          ))}
        </div>

        <div className="row">
          <span>数量</span>
          <div className="chips">
            {[1, 2, 4].map((value) => (
              <button
                key={value}
                className={`chip ${n === value ? "on" : ""}`}
                onClick={() => setN(value)}
              >
                {value}
              </button>
            ))}
          </div>
        </div>

        {mode === "image" && (
          <>
            <div className="hr" />
            <h3 className="section-title">
              参考图
              <span style={{ marginLeft: 6, color: "var(--accent)", textTransform: "none", letterSpacing: 0 }}>
                必填
              </span>
            </h3>
          </>
        )}

        {mode === "image" && (
          <div
            className="dropzone"
            data-dragging={dragging}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              void uploadFiles(Array.from(event.dataTransfer.files ?? []));
            }}
          >
            {refs.length === 0 ? (
              <>
                <div style={{ fontSize: 13, color: "var(--ink)", fontWeight: 600, marginBottom: 4 }}>
                  先放一张参考图
                </div>
                <div style={{ fontSize: 11.5, color: "var(--sub)", marginBottom: 10 }}>
                  拖拽、粘贴，或点下面的按钮
                </div>
                <button
                  className="btn"
                  onClick={() => fileInput.current?.click()}
                  disabled={uploading}
                >
                  {uploading ? "上传中…" : "选择图片"}
                </button>
              </>
            ) : (
              <div className="up" style={{ width: "100%" }}>
                {refs.map((ref, index) => (
                  <div key={ref.path} className="slot filled">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={ref.url} alt={`参考图 ${index + 1}`} />
                    <button
                      className="rm"
                      onClick={() => setRefs((prev) => prev.filter((item) => item.path !== ref.path))}
                      title="移除"
                    >
                      ×
                    </button>
                  </div>
                ))}
                {refs.length < 3 && (
                  <button className="slot" onClick={() => fileInput.current?.click()} disabled={uploading}>
                    {uploading ? "…" : "＋"}
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(event) => {
            void uploadFiles(Array.from(event.target.files ?? []));
            event.target.value = "";
          }}
        />

        <div className="hr" />
        <h3 className="section-title">提示词</h3>
        <textarea
          value={prompt}
          placeholder="描述你想要的画面，例如：星巴克「大有可为」高级海报，纯绿背景，超大 BREW 排版…"
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              void generate();
            }
          }}
        />

        {hasPromptPlaceholders(prompt) && (
          <p className="muted" style={{ color: "var(--warn)", fontSize: 11.5, margin: "6px 0 0" }}>
            提示词里还有 {"{...}"} 占位符，替换成具体内容再生成效果更稳
          </p>
        )}

        <button className="row" onClick={() => setShowNegative((value) => !value)} style={{ background: "none", width: "100%" }}>
          <span>负向提示词</span>
          <span>{showNegative ? "▴" : "▾"}</span>
        </button>
        {showNegative && (
          <textarea
            value={negative}
            placeholder="不想要的内容，例如：文字、水印、多余手指"
            onChange={(event) => setNegative(event.target.value)}
            style={{ minHeight: 62 }}
          />
        )}

        <div className="row">
          <span>随机种子</span>
          <button
            className="chip"
            onClick={() => setRandomSeed((value) => !value)}
            style={{ minWidth: 46 }}
          >
            {randomSeed ? "开" : "关"}
          </button>
        </div>
        {!randomSeed && (
          <input
            type="number"
            value={seed}
            placeholder="固定种子，复现同一张图"
            onChange={(event) => setSeed(event.target.value)}
            style={{ marginTop: 8 }}
          />
        )}

        {error && (
          <div style={{ color: "var(--danger)", fontSize: 12.5, marginTop: 10 }}>{error}</div>
        )}

        <button
          className="btn-primary"
          onClick={() => void generate()}
          disabled={
            !prompt.trim() || submitting || uploading || (mode === "image" && refs.length === 0)
          }
          style={{ marginTop: 14 }}
        >
          {submitting
            ? "提交中…"
            : busy
              ? "生成中…"
              : mode === "image" && refs.length === 0
                ? "先选择参考图"
                : `生成 ${n} 张`}
          <small>{estimate > 0 ? `预计 ¥${estimate.toFixed(2)}` : "限免"}</small>
        </button>
        <div style={{ textAlign: "center", fontSize: 11.5, color: "var(--sub)", marginTop: 8 }}>
          本地运行 · 失败不扣费 · ⌘↵ 快速生成 · 支持粘贴图片
        </div>
      </aside>

      {/* ---------------- 结果 ---------------- */}
      <section className="panel pad">
        <div className="stage-head">
          <h2>生成结果</h2>
          <div className="meta">
            {gen
              ? `${models.find((m) => m.key === gen.model_key)?.label ?? gen.model_key} · ${gen.params?.aspect_ratio ?? ratio} · ¥${gen.cost_cny.toFixed(2)} · ${STATUS_TEXT[gen.status]}${gen.progress ? ` ${gen.progress.done}/${gen.progress.total}` : ""}${busy ? ` ${elapsed}s` : ""}`
              : activeModel
                ? `${activeModel.label} · ${ratio} · ${n} 张 · ${estimate > 0 ? `预计 ¥${estimate.toFixed(2)}` : "限免"}`
                : ""}
          </div>
        </div>

        {!gen && (
          <>
            <div className="empty">
              <div style={{ fontSize: 15, color: "var(--ink)", fontWeight: 600, marginBottom: 6 }}>
                今天想做什么图？
              </div>
              <div style={{ fontSize: 12.5 }}>写提示词，或先套一个例子</div>
            </div>
            <div className="stage-head" style={{ marginTop: 12 }}>
              <span style={{ fontSize: 12, color: "var(--sub)" }}>快速开始</span>
            </div>
            <div className="chips">
              {EXAMPLES.map((example) => (
                <button
                  key={example.label}
                  className="chip"
                  onClick={() => setPrompt(example.prompt)}
                >
                  {example.label}
                </button>
              ))}
            </div>
          </>
        )}

        {gen && (
          <>
            {(gen.status === "queued" || gen.status === "running") && (
              <div className="result-masonry">
                {Array.from({ length: slots }).map((_, index) => (
                  <div
                    key={index}
                    className="shot skeleton"
                    style={{ aspectRatio: ratio.replace(":", " / ") }}
                  />
                ))}
              </div>
            )}

            {gen.status === "succeeded" && (
              <div className="result-masonry">
                {gen.assets.map((asset) => (
                  <div
                    key={asset.id}
                    className="shot"
                    onClick={() => setSelectedAsset(asset.id)}
                    title={`${asset.width}×${asset.height}`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={asset.thumb}
                      alt={gen.prompt.slice(0, 40)}
                      width={asset.width}
                      height={asset.height}
                      loading="lazy"
                    />
                    <div className="actions" onClick={(event) => event.stopPropagation()}>
                      <a href={asset.url} download={`adflow-${asset.id}.jpg`}>
                        下载
                      </a>
                      <LikeButton
                        liked={asset.favorite === 1}
                        size={14}
                        onClick={() => void toggleFavorite(asset)}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {(gen.status === "failed" || gen.status === "timeout") && (
              <div className="empty" style={{ borderColor: "#e3b3ac" }}>
                <div style={{ color: "var(--danger)", fontWeight: 600, marginBottom: 6 }}>
                  {gen.status === "timeout" ? "任务超时" : "生成失败"}
                </div>
                <div style={{ fontSize: 12.5, marginBottom: 12 }}>{gen.error ?? "上游没有返回原因"}</div>
                <button className="btn" onClick={() => void retry()}>
                  重试
                </button>
              </div>
            )}

            {gen.status === "succeeded" && (
              <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                <button className="btn" onClick={() => void generate()}>
                  ↻ 再来一批
                </button>
                <a className="btn" href="/library">
                  去图库看
                </a>
                <span style={{ fontSize: 12, color: "var(--sub)", alignSelf: "center" }}>
                  种子 {String(gen.params?.seed ?? "随机")} · 花费 ¥{gen.cost_cny.toFixed(2)}
                </span>
              </div>
            )}
          </>
        )}
      </section>

      {/* ---------------- 队列 ---------------- */}
      <aside className="panel pad queue-col">
        <h3 className="section-title">任务队列</h3>
        {queue.length === 0 && <div className="muted" style={{ fontSize: 12 }}>还没有任务</div>}
        {queue.slice(0, 5).map((item) => (
          <div key={item.id} className="task">
            <div className="line">
              <span className="nm" title={item.prompt}>
                {promptLabel(item.prompt)}
              </span>
              <span className={`badge ${item.status}`}>{STATUS_TEXT[item.status] ?? item.status}</span>
            </div>
            {item.status === "running" && (
              <div className="prog">
                <i style={{ width: "55%" }} />
              </div>
            )}
            {item.error && (
              <div style={{ fontSize: 11, color: "var(--danger)", marginTop: 4 }}>
                {item.error.slice(0, 40)}
              </div>
            )}
          </div>
        ))}
        <div className="hr" />
        <h3 className="section-title">最近素材</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 6 }}>
          {queue
            .filter((item) => item.thumb && !item.thumb.endsWith(".mp4"))
            .slice(0, 4)
            .map((item) => (
              <a key={item.id} href={item.thumb ?? "#"} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={item.thumb ?? ""}
                  alt=""
                  style={{ width: "100%", aspectRatio: "1", objectFit: "cover", borderRadius: 7 }}
                />
              </a>
            ))}
        </div>
      </aside>

      {selectedAsset && (
        <Lightbox
          assetId={selectedAsset}
          siblings={gen?.assets.map((asset) => asset.id)}
          onClose={() => setSelectedAsset(null)}
        />
      )}
    </div>
  );
}
