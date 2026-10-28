"use client";

import { useState } from "react";

interface Props {
  initial: Record<string, string>;
  models: { key: string; label: string; enabled: boolean }[];
}

export function SettingsForm({ initial, models }: Props) {
  const [form, setForm] = useState({
    monthly_budget_cny: initial.monthly_budget_cny ?? "50",
    default_tier: initial.default_tier ?? "fast",
    concurrency: initial.concurrency ?? "2",
  });
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const update = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  const save = async () => {
    setError("");
    const res = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "保存失败");
      return;
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="panel pad">
      <h3 className="section-title">偏好</h3>

      <label className="kv" style={{ gap: 12 }}>
        <span>本月预算（¥）</span>
        <input
          type="number"
          step="1"
          value={form.monthly_budget_cny}
          onChange={update("monthly_budget_cny")}
          style={{ width: 110, textAlign: "right" }}
        />
      </label>
      <label className="kv" style={{ gap: 12 }}>
        <span>默认档位</span>
        <select
          value={form.default_tier}
          onChange={update("default_tier")}
          style={{ width: 140, padding: "6px 8px", border: "1px solid var(--line)", borderRadius: 8 }}
        >
          {models
            .filter((model) => model.enabled)
            .map((model) => (
              <option key={model.key} value={model.key}>
                {model.label}
              </option>
            ))}
        </select>
      </label>
      <label className="kv" style={{ gap: 12 }}>
        <span>并发任务数</span>
        <input
          type="number"
          min={1}
          max={4}
          value={form.concurrency}
          onChange={update("concurrency")}
          style={{ width: 110, textAlign: "right" }}
        />
      </label>

      {error && <div style={{ color: "var(--danger)", fontSize: 12.5, marginTop: 10 }}>{error}</div>}

      <button className="btn" style={{ marginTop: 14 }} onClick={() => void save()}>
        {saved ? "已保存 ✓" : "保存"}
      </button>
      <p className="muted" style={{ fontSize: 11.5, marginBottom: 0 }}>
        并发数在下一轮调度（约 3 秒）生效。
      </p>
    </div>
  );
}
