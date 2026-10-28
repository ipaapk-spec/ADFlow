export interface CropPreset {
  key: "32:5" | "6:5";
  label: string;
  /** 固定输出尺寸 */
  width: number;
  height: number;
  desc: string;
}

/** 标准广告位尺寸：32:5 = 320×50，6:5 = 300×250。 */
export const CROP_PRESETS: Record<CropPreset["key"], CropPreset> = {
  "32:5": {
    key: "32:5",
    label: "32:5",
    width: 320,
    height: 50,
    desc: "移动端横幅 · 320×50",
  },
  "6:5": {
    key: "6:5",
    label: "6:5",
    width: 300,
    height: 250,
    desc: "中矩形 · 300×250",
  },
};

export function isCropRatio(value: string): value is CropPreset["key"] {
  return value === "32:5" || value === "6:5";
}
