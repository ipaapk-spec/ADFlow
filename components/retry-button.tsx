"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function RetryButton({ id }: { id: string }) {
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  return (
    <button
      className="btn"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await fetch(`/api/generations/${id}/retry`, { method: "POST" });
        setBusy(false);
        router.refresh();
      }}
    >
      {busy ? "…" : "重试"}
    </button>
  );
}
