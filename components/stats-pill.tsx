"use client";

import { useEffect, useState } from "react";

interface Stats {
  today: { count: number; costCny: number };
}

export function StatsPill() {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    const load = () =>
      fetch("/api/stats", { cache: "no-store" })
        .then((res) => res.json())
        .then((data: Stats) => setStats(data))
        .catch(() => undefined);
    load();
    const timer = setInterval(load, 30_000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="credit">
      {stats ? (
        <>
          今日 <b>{stats.today.count} 次</b> · ¥{stats.today.costCny.toFixed(2)}
        </>
      ) : (
        "本地运行"
      )}
    </div>
  );
}
