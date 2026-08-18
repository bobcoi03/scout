import { describe, expect, it } from "vitest";

import { hasValidCronAuthorization } from "@/lib/cron-auth";

describe("hasValidCronAuthorization", () => {
  it("accepts only the exact bearer secret", () => {
    const request = new Request("https://example.com/api/cron/ingest", {
      headers: { authorization: "Bearer correct-secret" },
    });
    expect(hasValidCronAuthorization(request, "correct-secret")).toBe(true);
    expect(hasValidCronAuthorization(request, "wrong-secret")).toBe(false);
  });

  it("fails closed when the secret or header is missing", () => {
    const request = new Request("https://example.com/api/cron/ingest");
    expect(hasValidCronAuthorization(request, "correct-secret")).toBe(false);
    expect(hasValidCronAuthorization(request, "")).toBe(false);
  });
});
