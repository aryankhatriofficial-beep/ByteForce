"use client";
import { ErrorState } from "@/components/ui/States";

export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="page container" style={{ paddingBlock: "var(--s-9)" }}>
      <ErrorState title="This view failed to render" action={<button type="button" className="btn" onClick={reset}>Try again</button>}>
        {error.message || "Unexpected client error."} No verification result is implied.
      </ErrorState>
    </div>
  );
}
