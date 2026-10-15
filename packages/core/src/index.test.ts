import { describe, expect, it } from "vitest";
import { CORE_VERSION } from "./index.ts";

describe("packages/core", () => {
  it("版を文字列で公開する", () => {
    expect(CORE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
