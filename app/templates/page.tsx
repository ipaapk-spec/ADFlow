import Link from "next/link";
import fs from "node:fs/promises";
import path from "node:path";

export const dynamic = "force-dynamic";

interface Template {
  id: string;
  name: string;
  cover: string;
  coverText: string;
  coverSub: string;
  ratio: string;
  model: string;
  prompt: string;
}

export default async function TemplatesPage() {
  const raw = await fs.readFile(path.join(process.cwd(), "config/templates.json"), "utf8");
  const templates = JSON.parse(raw) as Template[];

  return (
    <>
      <div className="stage-head">
        <h2 style={{ margin: 0, fontSize: 16 }}>模板</h2>
        <div className="meta">套用后自动填好提示词、比例与档位</div>
      </div>

      <div className="tplgrid">
        {templates.map((template) => (
          <div key={template.id} className="tpl">
            <div className="cover" style={{ background: template.cover }}>
              <div>
                <b>{template.coverText}</b>
                <small>{template.coverSub}</small>
              </div>
            </div>
            <div className="info">
              <div>
                <b>{template.name}</b>
                <br />
                <span>
                  {template.ratio} · {template.model === "fast" ? "极速" : "均衡"}档
                </span>
              </div>
              <Link
                className="btn"
                href={`/create?prompt=${encodeURIComponent(template.prompt)}&ratio=${encodeURIComponent(template.ratio)}&model=${encodeURIComponent(template.model)}`}
              >
                套用
              </Link>
            </div>
          </div>
        ))}
      </div>

      <p className="muted" style={{ fontSize: 12, marginTop: 16 }}>
        模板存在 <code className="mono">config/templates.json</code>，改文件刷新即可，不用发版。
      </p>
    </>
  );
}
