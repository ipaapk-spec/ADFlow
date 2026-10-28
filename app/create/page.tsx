import { Suspense } from "react";
import { CreateClient } from "@/components/create-client";

export const dynamic = "force-dynamic";

export default function CreatePage() {
  return (
    <Suspense fallback={<div className="panel pad muted">加载中…</div>}>
      <CreateClient />
    </Suspense>
  );
}
