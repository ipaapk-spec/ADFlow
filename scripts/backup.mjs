import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const dataDir = process.env.ADFLOW_DATA_DIR ?? path.join(process.cwd(), "data");
const dbFile = path.join(dataDir, "adflow.db");
const backupDir = path.join(dataDir, "backups");

if (!fs.existsSync(dbFile)) {
  console.log("还没有数据库，跳过备份");
  process.exit(0);
}
fs.mkdirSync(backupDir, { recursive: true });

// 先把 WAL 合并进主库，再复制，避免备份到一半的数据
const db = new DatabaseSync(dbFile);
db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
db.close();

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const dest = path.join(backupDir, `adflow-${stamp}.db`);
fs.copyFileSync(dbFile, dest);
console.log("已备份:", dest);

const files = fs
  .readdirSync(backupDir)
  .filter((name) => name.startsWith("adflow-") && name.endsWith(".db"))
  .sort();
while (files.length > 7) {
  const oldest = files.shift();
  fs.rmSync(path.join(backupDir, oldest));
  console.log("清理旧备份:", oldest);
}
