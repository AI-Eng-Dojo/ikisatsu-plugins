import { describe, expect, it } from "vitest";
import { TRANSCRIPT_LIMITS } from "./transcript.ts";

describe("TRANSCRIPT_LIMITS", () => {
  it("設計書どおりの上限", () => {
    expect(TRANSCRIPT_LIMITS).toEqual({
      maxEntries: 5000,
      maxTextChars: 20000,
      maxBodyBytes: 5 * 1024 * 1024,
    });
  });
});

import { isValidProjectId, isValidSessionId } from "./transcript.ts";

describe("isValidSessionId", () => {
  it.each(["abcdefgh", "a-b_c-1234", "x".repeat(128)])("通る: %s", (v) => {
    expect(isValidSessionId(v)).toBe(true);
  });
  it.each([
    "short",
    "x".repeat(129),
    "has space!",
    "../../etc/x",
    "日本語日本語日本語",
    "a/b/c/d/e/f",
  ])("弾く: %s", (v) => {
    expect(isValidSessionId(v)).toBe(false);
  });
});

describe("isValidProjectId", () => {
  it.each(["a", "my.repo-1_x", "x".repeat(100)])("通る: %s", (v) => {
    expect(isValidProjectId(v)).toBe(true);
  });
  it.each(["", ".", "..", "x".repeat(101), "a/b", "a b", "a\n"])("弾く: %j", (v) => {
    expect(isValidProjectId(v)).toBe(false);
  });
});
