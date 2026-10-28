export interface VideoModelSpec {
  key: string;
  /** 上游模型 ID */
  name: string;
  label: string;
  desc: string;
  /** 支持的清晰度档位，第一个是默认值 */
  sizes: string[];
  maxSeconds: number;
  estSeconds: number;
  /** 最多参考图数量（当前只做文生视频 / 首帧，占位） */
  maxImages: number;
  /** 人民币 / 秒，按清晰度档位 */
  pricePerSecondCny: Record<string, number>;
  enabled: boolean;
}

export const VIDEO_RATIOS = ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"] as const;

/**
 * Agnes Video 2.5 按秒计费，美元价按 7.2 折算成人民币：
 *   720P $0.025/s -> ¥0.18/s
 *   1080P / 1K $0.040/s -> ¥0.288/s
 *   2K $0.055/s -> ¥0.396/s
 * Flash 当前限时免费。
 */
export const VIDEO_MODELS: Record<string, VideoModelSpec> = {
  "video-flash": {
    key: "video-flash",
    name: "agnes-video-2.5-flash",
    label: "视频 Flash",
    desc: "agnes-video-2.5-flash · 720P · 当前限免",
    sizes: ["720P"],
    maxSeconds: 12,
    estSeconds: 60,
    maxImages: 5,
    pricePerSecondCny: { "720P": 0 },
    enabled: true,
  },
  "video-pro": {
    key: "video-pro",
    name: "agnes-video-2.5",
    label: "视频 2.5",
    desc: "agnes-video-2.5 · 最高 2K · 按秒计费",
    sizes: ["720P", "1080P", "1K", "2K"],
    maxSeconds: 12,
    estSeconds: 120,
    maxImages: 8,
    pricePerSecondCny: { "720P": 0.18, "1080P": 0.288, "1K": 0.288, "2K": 0.396 },
    enabled: true,
  },
};

export const VIDEO_MODEL_ORDER = ["video-flash", "video-pro"];

export function getVideoModel(key: string): VideoModelSpec {
  const model = VIDEO_MODELS[key];
  if (!model) throw new Error(`未知视频模型：${key}`);
  if (!model.enabled) throw new Error(`视频模型「${model.label}」当前未启用`);
  return model;
}

export function videoPriceCny(model: VideoModelSpec, size: string, seconds: number): number {
  const rate = model.pricePerSecondCny[size] ?? model.pricePerSecondCny[model.sizes[0]] ?? 0;
  return Math.round(rate * seconds * 10000) / 10000;
}
