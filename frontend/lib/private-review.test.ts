// @vitest-environment node
import { describe, expect, it } from "vitest";
import envelope from "./private-review.fixture.json";
import { decryptReview, originalBoard, reviewPoints, type ReviewAnswer, type ReviewData, type ReviewPoint } from "./private-review";

describe("private review delivery", () => {
  it("opens a Python-produced authenticated gzip envelope", async () => {
    const data = await decryptReview(envelope, "fixture-passphrase-2026");
    expect(data.summary.answer_observations).toBe(0);
    await expect(decryptReview(envelope, "wrong-password-2026")).rejects.toThrow("解锁失败");
    const changed = { ...envelope, data: (envelope.data[0] === "A" ? "B" : "A") + envelope.data.slice(1) };
    await expect(decryptReview(changed, "fixture-passphrase-2026")).rejects.toThrow("解锁失败");
  });
  it("rejects unsupported parameters before attempting expensive decryption", async () => {
    await expect(decryptReview({ ...envelope, iterations: 1e12 }, "unused")).rejects.toThrow("版本不受支持");
  });
});

const answer = { id: "a", topic_id: "topic", category: "社会", title: "测试社会事件", captured_at: "2026-11-26T10:00:00+08:00" } as ReviewAnswer;
const point = (task: string, label: string, state = "done"): ReviewPoint => ({ answer: "a", task, claim: "测试陈述", state,
  result: state === "done" ? { label, explanation: "测试差异", evidence: [], attribution: "consistent", modality: "same" } : null, sources: [], missing: [] });
const data = { answers: [answer], audit: [point("waiting", "", "blocked_missing_sources"), point("supported", "supported"), point("missing", "not_supported"), point("contradiction", "contradicted")] } as ReviewData;

it("shows concrete completed differences, never treating missing source text as a finding", () => {
  expect(reviewPoints(data).map(({ point }) => point.task)).toEqual(["contradiction", "missing"]);
  expect(reviewPoints(data, "other-topic")).toEqual([]);
  expect(reviewPoints(data, "", "", "财经")).toEqual([]);
  expect(reviewPoints(data, "topic", "测试社会", "社会")).toHaveLength(2);
});

it("links only an actually saved board no later than the answer", () => {
  const snapshot = (hour: number) => ({ origin: { path: `data/runs/${hour}.json`, url: `https://github.com/test/run/${hour}` }, data: { captured_at: `2026-11-26T${String(hour).padStart(2, "0")}:00:00+08:00`, topics: [{ topic_id: "topic" }] } });
  const boards = { ...data, runs: [snapshot(11), snapshot(9)], boards: [{ origin: { path: "data/hotlists/9.json", url: "https://github.com/test/board/9" } }] };
  expect(originalBoard(boards, answer)).toBe("https://github.com/test/board/9");
  expect(originalBoard({ ...boards, boards: [] }, answer)).toBeUndefined();
});
