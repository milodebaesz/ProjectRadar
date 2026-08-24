import { describe, it, expect, vi, afterEach } from "vitest";
import { projectKey, relativeTime } from "./format";

describe("projectKey", () => {
  it("normaliseert naar lowercase en trimt", () => {
    expect(projectKey("  Mijn-Project ")).toBe("mijn-project");
    expect(projectKey("Demo")).toBe(projectKey("demo"));
  });
});

describe("relativeTime", () => {
  afterEach(() => vi.useRealTimers());

  it("geeft een streepje bij null of onzin", () => {
    expect(relativeTime(null)).toBe("—");
    expect(relativeTime("geen-datum")).toBe("—");
  });

  it("schaalt van zojuist tot jaren", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-14T12:00:00Z"));
    const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
    expect(relativeTime(ago(10 * 1000))).toBe("zojuist");
    expect(relativeTime(ago(10 * 60 * 1000))).toBe("10 min geleden");
    expect(relativeTime(ago(3 * 3600 * 1000))).toBe("3u geleden");
    expect(relativeTime(ago(24 * 3600 * 1000))).toBe("gisteren");
    expect(relativeTime(ago(2 * 365 * 24 * 3600 * 1000))).toBe("2 jaar geleden");
  });
});
