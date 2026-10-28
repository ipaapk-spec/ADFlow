import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

export const DATA_DIR =
  process.env.ADFLOW_DATA_DIR ?? path.join(process.cwd(), "data");

export const IMAGES_DIR = path.join(DATA_DIR, "images");
export const THUMBS_DIR = path.join(DATA_DIR, "thumbs");
export const UPLOADS_DIR = path.join(DATA_DIR, "uploads");
export const VIDEOS_DIR = path.join(DATA_DIR, "videos");
export const TRASH_DIR = path.join(DATA_DIR, "trash");

for (const dir of [DATA_DIR, IMAGES_DIR, THUMBS_DIR, UPLOADS_DIR, VIDEOS_DIR, TRASH_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS generations (
  id TEXT PRIMARY KEY,
  mode TEXT NOT NULL,
  model_key TEXT NOT NULL,
  prompt TEXT NOT NULL,
  negative TEXT,
  params TEXT NOT NULL,
  status TEXT NOT NULL,
  cost_usd REAL NOT NULL DEFAULT 0,
  cost_cny REAL NOT NULL DEFAULT 0,
  upstream_task_id TEXT,
  client_request_id TEXT UNIQUE,
  batch_id TEXT,
  error TEXT,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  last_polled_at INTEGER,
  finished_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_generations_status ON generations(status);
CREATE INDEX IF NOT EXISTS idx_generations_created ON generations(created_at DESC);

CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  generation_id TEXT NOT NULL,
  path TEXT NOT NULL,
  thumb_path TEXT,
  width INTEGER NOT NULL DEFAULT 0,
  height INTEGER NOT NULL DEFAULT 0,
  bytes INTEGER NOT NULL DEFAULT 0,
  seed INTEGER,
  favorite INTEGER NOT NULL DEFAULT 0,
  project_id TEXT,
  deleted_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_assets_created ON assets(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_assets_gen ON assets(generation_id);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS presets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  model_key TEXT NOT NULL,
  aspect_ratio TEXT NOT NULL,
  n INTEGER NOT NULL,
  negative TEXT,
  prompt_prefix TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

const generationColumns = () =>
  db().prepare("PRAGMA table_info(generations)").all() as unknown as { name: string }[];

function migrate(): void {
  const columns = generationColumns();
  if (!columns.some((column) => column.name === "batch_id")) {
    db().exec("ALTER TABLE generations ADD COLUMN batch_id TEXT");
  }
  if (!columns.some((column) => column.name === "cost_cny")) {
    db().exec("ALTER TABLE generations ADD COLUMN cost_cny REAL NOT NULL DEFAULT 0");
    // 旧数据按 7.2 汇率从美元价折算一次
    db().exec("UPDATE generations SET cost_cny = ROUND(cost_usd * 7.2, 4) WHERE cost_cny = 0");
  }
}

export type GenerationStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "timeout";

export interface GenerationRow {
  id: string;
  mode: string;
  model_key: string;
  prompt: string;
  negative: string | null;
  params: string;
  status: GenerationStatus;
  cost_usd: number;
  cost_cny: number;
  upstream_task_id: string | null;
  client_request_id: string | null;
  batch_id: string | null;
  error: string | null;
  created_at: number;
  started_at: number | null;
  last_polled_at: number | null;
  finished_at: number | null;
}

export interface AssetRow {
  id: string;
  generation_id: string;
  path: string;
  thumb_path: string | null;
  width: number;
  height: number;
  bytes: number;
  seed: number | null;
  favorite: number;
  project_id: string | null;
  deleted_at: number | null;
  created_at: number;
}

declare global {
  // eslint-disable-next-line no-var
  var __adflowDb: DatabaseSync | undefined;
}

export function db(): DatabaseSync {
  if (!globalThis.__adflowDb) {
    const file = path.join(DATA_DIR, "adflow.db");
    const instance = new DatabaseSync(file);
    instance.exec(SCHEMA);
    globalThis.__adflowDb = instance;
    migrate();
    instance.exec("CREATE INDEX IF NOT EXISTS idx_generations_batch ON generations(batch_id)");
  }
  return globalThis.__adflowDb;
}

export const now = () => Date.now();
export const uid = () => crypto.randomUUID();

/* ---------------- generations ---------------- */

export function createGeneration(input: {
  mode: string;
  modelKey: string;
  prompt: string;
  negative?: string | null;
  params: Record<string, unknown>;
  costCny: number;
  clientRequestId?: string | null;
  batchId?: string | null;
}): GenerationRow {
  const id = uid();
  const ts = now();
  db()
    .prepare(
      `INSERT INTO generations
       (id, mode, model_key, prompt, negative, params, status, cost_usd, cost_cny, client_request_id, batch_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'queued', 0, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.mode,
      input.modelKey,
      input.prompt,
      input.negative ?? null,
      JSON.stringify(input.params),
      input.costCny,
      input.clientRequestId ?? null,
      input.batchId ?? null,
      ts,
    );
  return getGeneration(id)!;
}

export function getGeneration(id: string): GenerationRow | undefined {
  return db()
    .prepare("SELECT * FROM generations WHERE id = ?")
    .get(id) as unknown as GenerationRow | undefined;
}

export function getGenerationByClientId(
  clientRequestId: string,
): GenerationRow | undefined {
  return db()
    .prepare("SELECT * FROM generations WHERE client_request_id = ?")
    .get(clientRequestId) as unknown as GenerationRow | undefined;
}

export function listGenerations(limit = 30, offset = 0): GenerationRow[] {
  return db()
    .prepare(
      "SELECT * FROM generations ORDER BY created_at DESC LIMIT ? OFFSET ?",
    )
    .all(limit, offset) as unknown as GenerationRow[];
}

export function listByBatch(batchId: string): GenerationRow[] {
  return db()
    .prepare("SELECT * FROM generations WHERE batch_id = ? ORDER BY created_at ASC")
    .all(batchId) as unknown as GenerationRow[];
}

export function listQueued(limit: number): GenerationRow[] {
  return db()
    .prepare(
      "SELECT * FROM generations WHERE status = 'queued' ORDER BY created_at ASC LIMIT ?",
    )
    .all(limit) as unknown as GenerationRow[];
}

export function listRunning(): GenerationRow[] {
  return db()
    .prepare("SELECT * FROM generations WHERE status = 'running'")
    .all() as unknown as GenerationRow[];
}

export function countRunning(): number {
  const row = db()
    .prepare("SELECT COUNT(*) AS c FROM generations WHERE status = 'running'")
    .get() as unknown as { c: number };
  return row.c;
}

export function markRunning(id: string): void {
  db()
    .prepare(
      "UPDATE generations SET status = 'running', started_at = ?, last_polled_at = ?, error = NULL WHERE id = ?",
    )
    .run(now(), now(), id);
}

export function setUpstreamTask(id: string, taskId: string): void {
  db()
    .prepare(
      "UPDATE generations SET upstream_task_id = ?, last_polled_at = ? WHERE id = ?",
    )
    .run(taskId, now(), id);
}

export function markPolled(id: string): void {
  db()
    .prepare("UPDATE generations SET last_polled_at = ? WHERE id = ?")
    .run(now(), id);
}

export function finishGeneration(
  id: string,
  status: GenerationStatus,
  error?: string | null,
): void {
  db()
    .prepare(
      "UPDATE generations SET status = ?, error = ?, finished_at = ? WHERE id = ?",
    )
    .run(status, error ?? null, now(), id);
}

export function requeueGeneration(id: string): void {
  db()
    .prepare(
      "UPDATE generations SET status = 'queued', error = NULL, upstream_task_id = NULL, started_at = NULL, last_polled_at = NULL, finished_at = NULL WHERE id = ?",
    )
    .run(id);
}

export function deleteGeneration(id: string): void {
  db().prepare("DELETE FROM generations WHERE id = ?").run(id);
}

/* ---------------- assets ---------------- */

export function addAsset(input: {
  generationId: string;
  filePath: string;
  thumbPath: string | null;
  width: number;
  height: number;
  bytes: number;
  seed: number | null;
}): AssetRow {
  const id = uid();
  db()
    .prepare(
      `INSERT INTO assets
       (id, generation_id, path, thumb_path, width, height, bytes, seed, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.generationId,
      input.filePath,
      input.thumbPath,
      input.width,
      input.height,
      input.bytes,
      input.seed,
      now(),
    );
  return db()
    .prepare("SELECT * FROM assets WHERE id = ?")
    .get(id) as unknown as AssetRow;
}

export function getAsset(id: string): AssetRow | undefined {
  return db()
    .prepare("SELECT * FROM assets WHERE id = ? AND deleted_at IS NULL")
    .get(id) as unknown as AssetRow | undefined;
}

export function listAssets(opts: {
  q?: string;
  favorite?: boolean;
  generationId?: string;
  limit?: number;
  offset?: number;
}): AssetRow[] {
  // 图库只放生成图：视频去 /video，裁剪成品去 /materials
  const where: string[] = [
    "a.deleted_at IS NULL",
    "a.path NOT LIKE 'videos/%'",
    "g.mode <> 'crop'",
  ];
  const params: (string | number)[] = [];
  if (opts.q) {
    where.push("g.prompt LIKE ?");
    params.push(`%${opts.q}%`);
  }
  if (opts.favorite) where.push("a.favorite = 1");
  if (opts.generationId) {
    where.push("a.generation_id = ?");
    params.push(opts.generationId);
  }
  params.push(opts.limit ?? 60, opts.offset ?? 0);
  return db()
    .prepare(
      `SELECT a.* FROM assets a JOIN generations g ON g.id = a.generation_id
       WHERE ${where.join(" AND ")}
       ORDER BY a.created_at DESC LIMIT ? OFFSET ?`,
    )
    .all(...params) as unknown as AssetRow[];
}

export interface VideoAssetRow {
  id: string;
  path: string;
  bytes: number;
  created_at: number;
  prompt: string;
  model_key: string;
  params: string;
  generation_created_at: number;
}

export function listVideoAssets(limit = 12): VideoAssetRow[] {
  return db()
    .prepare(
      `SELECT a.id, a.path, a.bytes, a.created_at,
              g.prompt, g.model_key, g.params, g.created_at AS generation_created_at
       FROM assets a JOIN generations g ON g.id = a.generation_id
       WHERE a.deleted_at IS NULL AND a.path LIKE 'videos/%'
       ORDER BY a.created_at DESC LIMIT ?`,
    )
    .all(limit) as unknown as VideoAssetRow[];
}

export function listMaterialAssets(limit = 200): AssetRow[] {
  return db()
    .prepare(
      `SELECT a.* FROM assets a JOIN generations g ON g.id = a.generation_id
       WHERE a.deleted_at IS NULL AND g.mode = 'crop'
       ORDER BY a.created_at DESC LIMIT ?`,
    )
    .all(limit) as unknown as AssetRow[];
}

export function listAssetsForGeneration(generationId: string): AssetRow[] {
  return db()
    .prepare(
      "SELECT * FROM assets WHERE generation_id = ? AND deleted_at IS NULL ORDER BY created_at ASC",
    )
    .all(generationId) as unknown as AssetRow[];
}

export function toggleFavorite(id: string): AssetRow | undefined {
  db()
    .prepare(
      "UPDATE assets SET favorite = CASE favorite WHEN 1 THEN 0 ELSE 1 END WHERE id = ?",
    )
    .run(id);
  return getAsset(id);
}

export function softDeleteAsset(id: string): void {
  db().prepare("UPDATE assets SET deleted_at = ? WHERE id = ?").run(now(), id);
}

/* ---------------- stats & settings ---------------- */

export function statsToday(): { count: number; costCny: number } {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return statsSince(start.getTime());
}

export function statsMonth(): { count: number; costCny: number } {
  const start = new Date();
  start.setDate(1);
  start.setHours(0, 0, 0, 0);
  return statsSince(start.getTime());
}

function statsSince(ts: number): { count: number; costCny: number } {
  const row = db()
    .prepare(
      `SELECT COUNT(*) AS count, COALESCE(SUM(cost_cny), 0) AS cost
       FROM generations WHERE created_at >= ? AND status = 'succeeded'`,
    )
    .get(ts) as unknown as { count: number; cost: number };
  return { count: row.count, costCny: row.cost };
}

export function statsByModel(): { model_key: string; count: number; cost: number }[] {
  return db()
    .prepare(
      `SELECT model_key, COUNT(*) AS count, COALESCE(SUM(cost_cny), 0) AS cost
       FROM generations WHERE status = 'succeeded' GROUP BY model_key ORDER BY cost DESC`,
    )
    .all() as unknown as { model_key: string; count: number; cost: number }[];
}

export function getSetting(key: string, fallback: string): string {
  const row = db()
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get(key) as unknown as { value: string } | undefined;
  return row?.value ?? fallback;
}

export function setSetting(key: string, value: string): void {
  db()
    .prepare(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .run(key, value);
}

export function allSettings(): Record<string, string> {
  const rows = db().prepare("SELECT key, value FROM settings").all() as unknown as {
    key: string;
    value: string;
  }[];
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

/* ---------------- presets ---------------- */

export interface PresetRow {
  id: string;
  name: string;
  model_key: string;
  aspect_ratio: string;
  n: number;
  negative: string | null;
  prompt_prefix: string | null;
  created_at: number;
}

export function listPresets(): PresetRow[] {
  return db()
    .prepare("SELECT * FROM presets ORDER BY created_at DESC")
    .all() as unknown as PresetRow[];
}

export function createPreset(input: {
  name: string;
  modelKey: string;
  aspectRatio: string;
  n: number;
  prompt: string;
  negative?: string | null;
}): PresetRow {
  const id = uid();
  db()
    .prepare(
      `INSERT INTO presets (id, name, model_key, aspect_ratio, n, negative, prompt_prefix, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.name,
      input.modelKey,
      input.aspectRatio,
      input.n,
      input.negative ?? null,
      input.prompt,
      now(),
    );
  return db()
    .prepare("SELECT * FROM presets WHERE id = ?")
    .get(id) as unknown as PresetRow;
}

export function deletePreset(id: string): void {
  db().prepare("DELETE FROM presets WHERE id = ?").run(id);
}

export function getAssetWithGeneration(
  id: string,
): { asset: AssetRow; generation: GenerationRow } | undefined {
  const asset = getAsset(id);
  if (!asset) return undefined;
  const generation = getGeneration(asset.generation_id);
  if (!generation) return undefined;
  return { asset, generation };
}
