import type { Interview, Report, Transcript } from "./types";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, init);
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.detail ?? `Request failed (${response.status})`);
  }
  return response.status === 204 ? (undefined as T) : response.json();
}

export const listInterviews = () => request<Interview[]>("/interviews");

export const getInterview = (id: string) =>
  request<{ interview: Interview; report: Report | null }>(`/interviews/${id}`);

export const getTranscript = (id: string) => request<Transcript>(`/interviews/${id}/transcript`);

export const mediaUrl = (id: string) => `${API_URL}/interviews/${id}/media`;

export const deleteInterview = (id: string) => request<void>(`/interviews/${id}`, { method: "DELETE" });

export const rerunInterview = (id: string) => request<void>(`/interviews/${id}/rerun`, { method: "POST" });

export const sendFeedback = (id: string, flagId: string, useful: boolean, reason: string) =>
  request<void>(`/interviews/${id}/flags/${flagId}/feedback`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ useful, reason }),
  });

/** XMLHttpRequest, because fetch cannot report upload progress and recordings are large. */
export function createInterview(form: FormData, onProgress: (fraction: number) => void): Promise<Interview> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_URL}/interviews`);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onerror = () => reject(new Error("Could not reach the review service. Is the backend running?"));
    xhr.onload = () => {
      const body = JSON.parse(xhr.responseText || "null");
      if (xhr.status >= 200 && xhr.status < 300) resolve(body);
      else reject(new Error(body?.detail ?? `Upload failed (${xhr.status})`));
    };
    xhr.send(form);
  });
}

// --- live session logging (SPEC §6) ---

export interface QuestionEvent {
  id: string;
  text?: string;
  parent_id?: string | null;
  started_at?: string | null;
  ended_at?: string | null;
  answer_started_at?: string | null;
  answer_ended_at?: string | null;
}

export interface CanaryEvent {
  canary_id: string;
  question_id?: string | null;
  expected_marker: string;
  instruction?: string;
  delivery_method?: string;
  gain_db?: number | null;
  sent_at: string;
  finished_at?: string | null;
  response_contained_marker?: boolean | null;
  matched_text?: string | null;
  candidate_acknowledged_hearing?: boolean;
}

export const logQuestion = (id: string, event: QuestionEvent) =>
  request<void>(`/interviews/${id}/questions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(event),
  });

export const logCanary = (id: string, event: CanaryEvent) =>
  request<void>(`/interviews/${id}/canaries`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(event),
  });

export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
