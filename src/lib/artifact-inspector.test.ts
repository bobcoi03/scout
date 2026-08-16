import os from "node:os";
import path from "node:path";

import { beforeAll, describe, expect, it, vi } from "vitest";

let extractPageEvidence: typeof import("@/lib/artifact-inspector").extractPageEvidence;
let assertPublicHttpUrl: typeof import("@/lib/artifact-inspector").assertPublicHttpUrl;

beforeAll(async () => {
  vi.stubEnv("SCOUT_DB_PATH", path.join(os.tmpdir(), `scout-artifact-test-${process.pid}.db`));
  ({ extractPageEvidence, assertPublicHttpUrl } = await import("@/lib/artifact-inspector"));
});

describe("artifact inspection", () => {
  it("extracts useful page copy without script noise", () => {
    const evidence = extractPageEvidence(`
      <html><head><title>Useful Product</title><meta name="description" content="A real developer tool"></head>
      <body><script>domain is for sale</script><main>Inspect and replay agent sessions.</main></body></html>
    `);
    expect(evidence.title).toBe("Useful Product");
    expect(evidence.description).toBe("A real developer tool");
    expect(evidence.pageText).toContain("Inspect and replay agent sessions.");
    expect(evidence.parked).toBe(false);
  });

  it("detects parked and token-sale surfaces", () => {
    const parked = extractPageEvidence("<title>Buy this domain</title><p>This domain may be for sale</p>");
    const token = extractPageEvidence("<h1>Fair launch</h1><p>Connect wallet to buy on the bonding curve</p>");
    expect(parked.parked).toBe(true);
    expect(token.cryptoPromotion).toBe(true);
  });

  it("blocks loopback and private-network destinations", async () => {
    await expect(assertPublicHttpUrl("http://127.0.0.1:3000/private")).rejects.toThrow(/private/i);
    await expect(assertPublicHttpUrl("http://192.168.1.2/admin")).rejects.toThrow(/private/i);
  });
});
