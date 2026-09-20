import { notFound } from "next/navigation";
import { LiveRecordingTest } from "@/tests/live-recording-browser";

export default function Page() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <LiveRecordingTest />;
}
