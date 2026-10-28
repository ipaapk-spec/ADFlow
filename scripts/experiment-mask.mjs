// 实验：验证 RunningHub 的 image-to-image 是否真的按 mask 局部重绘
// 做法：同一张图、同一个 prompt（整图转黑白），分别带 mask 和不带 mask 提交，
// 然后比较「遮罩内」和「遮罩外」的饱和度：若带 mask 时遮罩外仍有颜色、遮罩内变灰，说明 mask 生效。
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const BASE = process.env.RUNNINGHUB_BASE_URL || "https://www.runninghub.ai";
const KEY = process.env.RUNNINGHUB_API_KEY;
const ENDPOINT = "rhart-image-n-g31-flash-lite/image-to-image";
if (!KEY) throw new Error("缺少 RUNNINGHUB_API_KEY");

const OUT = path.join(process.cwd(), "temp/experiment");
fs.mkdirSync(OUT, { recursive: true });

const W = 1024, H = 1024;
const CIRCLE = { cx: 640, cy: 512, r: 220 }; // 遮罩圆：中偏右

const source = process.argv[2];
if (!source) throw new Error("用法: node scripts/experiment-mask.mjs <图片路径>");

const base = await sharp(source).rotate().resize(W, H, { fit: "cover" }).jpeg({ quality: 92 }).toBuffer();
fs.writeFileSync(path.join(OUT, "base.jpg"), base);

// 黑底白圆 = 常见 mask 语义（白色为要重绘区域）
const maskSvg = `<svg width="${W}" height="${H}"><rect width="100%" height="100%" fill="black"/><circle cx="${CIRCLE.cx}" cy="${CIRCLE.cy}" r="${CIRCLE.r}" fill="white"/></svg>`;
const mask = await sharp(Buffer.from(maskSvg)).png().toBuffer();
fs.writeFileSync(path.join(OUT, "mask.png"), mask);

async function upload(buffer, name, type) {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(buffer)], { type }), name);
  const res = await fetch(`${BASE}/openapi/v2/media/upload/binary`, {
    method: "POST", headers: { Authorization: `Bearer ${KEY}` }, body: form,
  });
  const data = await res.json();
  const url = data?.data?.download_url;
  if (!url) throw new Error("上传失败: " + JSON.stringify(data).slice(0, 200));
  return url;
}

async function submit(payload) {
  const res = await fetch(`${BASE}/openapi/v2/${ENDPOINT}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!data.taskId) throw new Error("提交失败: " + JSON.stringify(data).slice(0, 200));
  return data.taskId;
}

async function wait(taskId) {
  for (let i = 0; i < 40; i += 1) {
    await new Promise((r) => setTimeout(r, 4000));
    const res = await fetch(`${BASE}/openapi/v2/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ taskId }),
    });
    const data = await res.json();
    if (data.status === "SUCCESS") return (data.results || []).map((x) => x.url);
    if (data.status === "FAILED") throw new Error("任务失败: " + (data.errorMessage || ""));
  }
  throw new Error("超时");
}

// 区域统计：饱和度 = max(r,g,b)-min(r,g,b)
async function stats(file) {
  const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const res = { in: { sat: 0, n: 0 }, out: { sat: 0, n: 0 } };
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      const i = (y * width + x) * channels;
      const sat = Math.max(data[i], data[i + 1], data[i + 2]) - Math.min(data[i], data[i + 1], data[i + 2]);
      const inside = (x - CIRCLE.cx) ** 2 + (y - CIRCLE.cy) ** 2 <= CIRCLE.r ** 2;
      const bucket = inside ? res.in : res.out;
      bucket.sat += sat; bucket.n += 1;
    }
  }
  return {
    in: +(res.in.sat / res.in.n).toFixed(1),
    out: +(res.out.sat / res.out.n).toFixed(1),
  };
}

const baseSat = await stats(path.join(OUT, "base.jpg"));
console.log("原图饱和度 in/out:", baseSat);

const baseUrl = await upload(base, "base.jpg", "image/jpeg");
const maskUrl = await upload(mask, "mask.png", "image/png");
const prompt = "Convert the entire image to high-contrast black and white photography, no color left.";

console.log("提交 control（不带 mask）…");
const controlTask = await submit({ imageUrls: [baseUrl], prompt, aspectRatio: "1:1" });
console.log("提交 masked（带 maskUrl）…");
const maskedTask = await submit({ imageUrls: [baseUrl], maskUrl, prompt, aspectRatio: "1:1" });

const [controlUrls, maskedUrls] = await Promise.all([wait(controlTask), wait(maskedTask)]);
const download = async (url, name) => {
  const res = await fetch(url);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(path.join(OUT, name), buf);
  return path.join(OUT, name);
};
const controlFile = await download(controlUrls[0], "control.jpg");
const maskedFile = await download(maskedUrls[0], "masked.jpg");

console.log("control 饱和度:", await stats(controlFile));
console.log("masked  饱和度:", await stats(maskedFile));
console.log("文件:", OUT);
