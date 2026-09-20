import type { Interview } from "@/lib/types";

export function StatusChip({ interview }: { interview: Interview }) {
  const label =
    interview.stage === "live" ? "Live room" : interview.status === "processing"
      ? `${interview.stage} · ${Math.round(interview.progress * 100)}%`
      : interview.status === "ready"
        ? "Ready"
        : "Failed";
  const tone = interview.status === "failed" ? "text-danger border-danger/40" : "text-muted border-border";
  return <span className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs capitalize ${tone}`}>{label}</span>;
}
