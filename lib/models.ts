export type ModelProvider = "runninghub" | "agnes";

export interface ModelSpec {
  key: string;
  /** 上游模型名，详情页展示用 */
  name: string;
  label: string;
  desc: string;
  /** 上游单价，人民币/张（来自 RunningHub SKU 目录 / Agnes 现价） */
  priceCny: number;
  estSeconds: number;
  /** 默认 runninghub；agnes 走同步 /v1/images/generations */
  provider?: ModelProvider;
  endpoints: {
    text?: string;
    image?: string;
  };
  maxRefs: number;
  enabled: boolean;
  /** 目录里对应的 SKU 名，方便核对 */
  sku?: string;
}

/**
 * 2026-10-28 实测结论（同一个 Key）：
 *
 * 可调用（已逐个提交验证）：
 *   rhart-image-n-g31-flash-lite/{text,image}-to-image   nano-banana-2-lite   ¥0.07
 *   rhart-image-v1/{text-to-image,edit}                  nano-banana 1        ¥0.07
 *   seedream-v5-lite/{text,image}-to-image               seedream v5 lite     ¥0.22
 *   rhart-image-g-2/text-to-image                        gpt-image-2.0        ¥0.10
 *   rhart-image-v1-official/edit                         nano-banana 1 稳定版  ¥0.20
 *
 * 不可调用（99 个图片 endpoint 里绝大多数）：
 *   errorCode 1007 = 接口存在但当前 Key 无权限
 *   errorCode 1001 = 路径不存在（目录里的模型名不是调用名）
 *   例如 nano-banana-2、nano-banana-pro、gpt-image-2.5、z-image、qwen-image、
 *   seedream-v5-pro、midjourney(悠船) 全部 1007。
 *
 * 解锁方法：在 RunningHub 控制台给这个 API Key 开通对应 SKU，
 * 用 /api/sku/list 拿 rhEndpoint，填进下面的 endpoints 即可。
 */
export const MODELS: Record<string, ModelSpec> = {
  fast: {
    key: "fast",
    name: "nano-banana 2 lite",
    label: "极速",
    desc: "nano-banana 2 lite · 便宜，适合试稿和铺量",
    priceCny: 0.07,
    estSeconds: 12,
    endpoints: {
      text: "rhart-image-n-g31-flash-lite/text-to-image",
      image: "rhart-image-n-g31-flash-lite/image-to-image",
    },
    maxRefs: 10,
    enabled: true,
    sku: "nano-banana-2-lite/*/economy",
  },
  agnes: {
    key: "agnes",
    name: "agnes-image-2.5-flash",
    label: "Agnes",
    desc: "agnes-image-2.5-flash · 2K 高清，文生图 / 图生图 / 多图合成（限免，4:5 按 3:4 出图）",
    priceCny: 0,
    estSeconds: 60,
    provider: "agnes",
    endpoints: {
      text: "agnes-image-2.5-flash",
      image: "agnes-image-2.5-flash",
    },
    maxRefs: 10,
    enabled: true,
  },
  classic: {
    key: "classic",
    name: "nano-banana 1",
    label: "经典",
    desc: "nano-banana 1 · 质感更稳，支持编辑",
    priceCny: 0.07,
    estSeconds: 15,
    endpoints: {
      text: "rhart-image-v1/text-to-image",
      image: "rhart-image-v1/edit",
    },
    maxRefs: 10,
    enabled: true,
    sku: "nano-banana/*/economy",
  },
  balanced: {
    key: "balanced",
    name: "seedream v5 lite",
    label: "均衡",
    desc: "seedream v5 lite · 细节和文字更清楚",
    priceCny: 0.22,
    estSeconds: 20,
    endpoints: {
      text: "seedream-v5-lite/text-to-image",
      image: "seedream-v5-lite/image-to-image",
    },
    maxRefs: 10,
    enabled: true,
    sku: "seedream-v5-lite",
  },
  gpt: {
    key: "gpt",
    name: "gpt-image-2.0",
    label: "GPT 图",
    desc: "gpt-image-2.0 · 指令跟随强，仅文生图",
    priceCny: 0.1,
    estSeconds: 25,
    endpoints: {
      text: "rhart-image-g-2/text-to-image",
    },
    maxRefs: 10,
    enabled: true,
    sku: "gpt-image-2.0/text-to-image/economy",
  },
  pro: {
    key: "pro",
    name: "nano-banana 1 稳定版",
    label: "精品",
    desc: "nano-banana 1 稳定版 · 编辑质量更高，仅图生图",
    priceCny: 0.2,
    estSeconds: 25,
    endpoints: {
      image: "rhart-image-v1-official/edit",
    },
    maxRefs: 10,
    enabled: true,
    sku: "nano-banana/edit/stable",
  },
};

export const MODEL_ORDER = ["fast", "agnes", "classic", "balanced", "gpt", "pro"];

/** Agnes 的密钥是否已配置；没配就不在档位里显示。 */
export function agnesConfigured(): boolean {
  const url = (process.env.AGNES_URL || process.env.AGNES_BASE_URL || "").trim();
  const key = (process.env.AGNES_KEY || process.env.AGNES_API_KEY || "").trim();
  return Boolean(url && key);
}

export function isModelEnabled(model: ModelSpec): boolean {
  return model.enabled && (model.provider !== "agnes" || agnesConfigured());
}

export function modelsForMode(mode: "text" | "image"): ModelSpec[] {
  return MODEL_ORDER.map((key) => MODELS[key]).filter(
    (model) =>
      isModelEnabled(model) &&
      (mode === "text" ? Boolean(model.endpoints.text) : Boolean(model.endpoints.image)),
  );
}

export function getModel(key: string): ModelSpec {
  const model = MODELS[key];
  if (!model) throw new Error(`未知模型：${key}`);
  if (!isModelEnabled(model)) throw new Error(`模型「${model.label}」当前未启用`);
  return model;
}

export const ASPECT_RATIOS = ["1:1", "4:5", "3:4", "9:16", "16:9"] as const;
