import { describe, expect, it } from "vitest";
import { safeHref } from "../src/lib/fmt";

describe("safeHref (news links from untrusted RSS feeds)", () => {
  it("allows plain http and https links", () => {
    expect(safeHref("https://example.com/story")).toBe(true);
    expect(safeHref("HTTP://example.com/story")).toBe(true);
  });
  it("rejects script and other schemes", () => {
    for (const bad of [
      "javascript:alert(1)",
      " JavaScript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox(1)",
      "//evil.example.com",
      "/relative/path",
      "",
    ]) {
      expect(safeHref(bad), bad).toBe(false);
    }
  });
  it("rejects non-strings", () => {
    expect(safeHref(undefined)).toBe(false);
    expect(safeHref(null)).toBe(false);
    expect(safeHref(42)).toBe(false);
  });
});
