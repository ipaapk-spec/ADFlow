/** 形如 `[TITLE]: {Editorial headline}` 的未填占位行，不适合直接当作任务标题。 */
const PLACEHOLDER_LINE = /^\[[^\]]+\]:\s*\{[^}]*\}\s*$/;

/** 判断提示词里是否还有 `{...}` 占位符。 */
export function hasPromptPlaceholders(prompt: string): boolean {
  return /\{[^}\n]+\}/.test(prompt);
}

/**
 * 从提示词里提取一个可读的短标题：
 * - 跳过 `[TAG]: {占位}` 这种模板行；
 * - 有 `[TITLE]: 夏日大片` 时用 TITLE 的值；
 * - 否则用第一段正文；
 * - 去掉行首的 `[TAG]:` 和纯 `{占位}`。
 */
export function promptLabel(prompt: string, max = 20): string {
  const lines = prompt
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return "（无提示词）";

  const meaningful = lines.filter((line) => !PLACEHOLDER_LINE.test(line));
  let text = (meaningful[0] ?? lines[0]).replace(/^\[[^\]]+\]:\s*/, "").trim();
  text = text.replace(/^(\{[^}]*\}\s*)+/, "").trim();
  if (!text) return "未填写的提示词模板";
  text = text.replace(/\s+/g, " ");
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
