export type ReviewSource = { mid: string; body: string; username?: string; url?: string; observed_at?: string; uid?: string; account?: { badge?: string } };
export type ReviewAnswer = { id: string; topic_id: string; title: string; captured_at: string; answer_version: string; category?: string; body: string; origin: { url: string }; citations: { id: string; original_line: number }[] };
export type ReviewPoint = { answer: string; task: string; claim: string; context?: string; claim_detail?: { start: number; end: number; citation_ids?: string[] }; state: string; checked_at?: string; result: null | { label: string; explanation: string; evidence: { mid: string; quote: string }[]; attribution: string; modality: string }; sources: ReviewSource[]; missing: string[] };
export type ReviewVersion = { topic_id: string; before: Pick<ReviewAnswer, "title" | "captured_at" | "origin">; after: Pick<ReviewAnswer, "title" | "captured_at" | "origin">; body_changed: boolean; native_changed: boolean; state: string; inline_sources_before: string[]; inline_sources_after: string[]; matches: { before_text: string; after_text: string; relation: string; explanation: string }[]; unmatched_before: string[]; unmatched_after: string[] };
export type ReviewData = {
  summary: { updated_at: string; answer_observations: number; missing_bodies: number; remaining_answer_files: number };
  answers: ReviewAnswer[]; audit: ReviewPoint[]; versions: ReviewVersion[];
  events: Record<string, { id: string; title: string }>;
  memberships: Record<string, { event_id: string | null }>;
  topics: Record<string, { title?: string; category?: string; first_seen_at?: string; last_seen_at?: string }>;
  accounts: Record<string, { uid: string; username: string; observed_at?: string; fields: Record<string, unknown> }>;
  account_types: Record<string, { publisher_type: string; explanation: string; evidence: string[] }>;
  boards: { origin: { path: string; url: string } }[];
  runs: { origin: { path: string; url: string }; data: { captured_at: string; topics: { topic_id: string }[] } }[];
};

export const REVIEW_DATA_URL = "https://raw.githubusercontent.com/nateafish/weibo-hot-hub/adapter-data/review.enc.json";
const aad = new TextEncoder().encode("weibo-hot-hub/private-review/v1");

function bytes(value: unknown, limit: number): Uint8Array<ArrayBuffer> {
  if (typeof value !== "string" || value.length > limit * 1.4 + 8) throw new Error("核查数据格式不正确");
  const raw = atob(value);
  if (raw.length > limit) throw new Error("核查数据过大");
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

export async function decryptReview(envelope: unknown, passphrase: string): Promise<ReviewData> {
  if (!envelope || typeof envelope !== "object") throw new Error("核查数据格式不正确");
  const e = envelope as Record<string, unknown>;
  if (e.format !== "weibo-private-review" || e.version !== 1 || e.cipher !== "AES-256-GCM" || e.kdf !== "PBKDF2-SHA256" || e.iterations !== 600000 || e.compression !== "gzip") throw new Error("核查数据版本不受支持");
  const salt = bytes(e.salt, 16), nonce = bytes(e.nonce, 12);
  if (salt.length !== 16 || nonce.length !== 12) throw new Error("核查数据格式不正确");
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: 600000, hash: "SHA-256" }, material, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce, additionalData: aad, tagLength: 128 }, key, bytes(e.data, 40_000_000));
  } catch { throw new Error("解锁失败，请核对你设置的口令。"); }
  const reader = new Blob([plain]).stream().pipeThrough(new DecompressionStream("gzip")).getReader();
  const parts: Uint8Array<ArrayBuffer>[] = []; let length = 0;
  while (true) {
    const { value, done } = await reader.read(); if (done) break;
    length += value.length;
    if (length > 80_000_000) { await reader.cancel(); throw new Error("核查数据过大，请联系维护者"); }
    parts.push(new Uint8Array(value));
  }
  const data = JSON.parse(await new Blob(parts).text()) as ReviewData;
  if (!data.summary || !Array.isArray(data.answers) || !Array.isArray(data.audit) || !data.accounts || !data.events || !Array.isArray(data.versions)) throw new Error("核查数据结构不完整");
  return data;
}

export function reviewPoints(data: ReviewData, topic = "", query = "", category = "") {
  const answers = new Map(data.answers.map((answer) => [answer.id, answer]));
  return data.audit.flatMap((point) => {
    const answer = answers.get(point.answer);
    if (!answer || point.state !== "done" || !point.result) return [];
    if (point.result.label === "supported" && point.result.attribution !== "changed" && point.result.modality !== "stronger_in_answer") return [];
    if (topic && answer.topic_id !== topic || category && (answer.category || "类别未记录") !== category) return [];
    if (query && !`${answer.title} ${point.claim} ${point.result.explanation}`.toLowerCase().includes(query.toLowerCase())) return [];
    return [{ point, answer }];
  }).sort((a, b) => Number(b.point.result?.label === "contradicted") - Number(a.point.result?.label === "contradicted") || Date.parse(b.answer.captured_at) - Date.parse(a.answer.captured_at));
}

export function originalBoard(data: ReviewData, answer: ReviewAnswer): string | undefined {
  const runs = data.runs.filter((run) => run.data.topics?.some((topic) => topic.topic_id === answer.topic_id) && Date.parse(run.data.captured_at) <= Date.parse(answer.captured_at))
    .sort((a, b) => Date.parse(b.data.captured_at) - Date.parse(a.data.captured_at));
  const run = runs[0]; if (!run) return;
  return data.boards.find((board) => board.origin.path === run.origin.path.replace("data/runs/", "data/hotlists/"))?.origin.url;
}
