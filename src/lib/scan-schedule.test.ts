import { describe, expect, it } from "vitest";

import { dailyScanWindow, scanRetryDelayMs, shiftUtcDay } from "@/lib/scan-schedule";

describe("scan scheduling", () => {
  it("selects the previous UTC day and a seven-day catch-up window", () => {
    expect(dailyScanWindow(new Date("2026-07-23T01:15:00.000Z"))).toEqual({
      finalDay: "2026-07-22",
      catchupFrom: "2026-07-16",
    });
    expect(shiftUtcDay("2024-03-01", -1)).toBe("2024-02-29");
  });

  it("waits through an X rate-limit reset with a small safety margin", () => {
    const error = {
      response: {
        headers: {
          get: (name: string) => name === "x-rate-limit-reset" ? "1000051" : null,
        },
      },
    };
    expect(scanRetryDelayMs(error, 1, 1_000_000_000)).toBe(56_000);
  });

  it("uses increasing fallback delays for ordinary failures", () => {
    expect(scanRetryDelayMs(new Error("network failure"), 1)).toBe(30_000);
    expect(scanRetryDelayMs(new Error("network failure"), 2)).toBe(60_000);
  });
});
