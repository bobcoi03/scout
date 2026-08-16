import { describe, expect, it } from "vitest";

import {
  analyzeSiteHtml,
  hasEstablishedProjectResurface,
  hasThinClaimArtifactMismatch,
  investigationEventKey,
  isFirstPartyBuilderText,
} from "@/lib/investigator-evidence";
import type { FeedPost, InvestigationPacket, InvestigatorRepositoryEvidence, InvestigatorSiteEvidence, PostAnalysis } from "@/db";

describe("investigator evidence", () => {
  it("extracts care and low-effort signals from a landing page", () => {
    const evidence = analyzeSiteHtml("https://careful-product.vercel.app/", `
      <html>
        <head><title>Careful Product</title></head>
        <body>
          <img src="/screen.png"><img src="/detail.png">
          <a href="/app">Open app</a>
          <a href="/docs">Documentation</a>
          <a href="https://github.com/example/careful-product">GitHub</a>
          <p>Coming soon</p>
        </body>
      </html>
    `, "Careful Product", null);

    expect(evidence.temporaryHost).toBe(true);
    expect(evidence.hasWorkingProductLink).toBe(true);
    expect(evidence.hasDocs).toBe(true);
    expect(evidence.imageCount).toBe(2);
    expect(evidence.notableLinks).toContain("https://github.com/example/careful-product");
    expect(evidence.placeholderSignals.length).toBeGreaterThan(0);
  });

  it("uses a repository as the stable launch-event identity", () => {
    const site = { host: "product.test" } as InvestigatorSiteEvidence;
    const repository = { fullName: "Example/Product", unavailableReason: null } as InvestigatorRepositoryEvidence;
    const analysis = { projectKey: "Different Name" } as PostAnalysis;
    const post = { id: "123" } as FeedPost;

    expect(investigationEventKey(analysis, [site], [repository], post)).toBe("github:example/product");
  });

  it("rejects infrastructure claims backed only by a tiny marketing repository", () => {
    const post = {
      text: "A complete Vulkan and WebGPU runtime for large AI model execution on consumer hardware.",
    } as FeedPost;
    const packet = {
      repositories: [{
        unavailableReason: null,
        totalFiles: 7,
        sourceFiles: 1,
        languages: { HTML: 16_000, CSS: 11_000, Python: 5_000 },
        description: "A distributed PyTorch engine.",
        representativeFiles: [{ path: "site/tools/generate_logo.py", excerpt: "Generate the logo." }],
      }],
    } as unknown as InvestigationPacket;

    expect(hasThinClaimArtifactMismatch(post, packet)).toBe(true);
  });

  it("does not mistake third-party commentary followed by 'built on' for authorship", () => {
    expect(isFirstPartyBuilderText("The best alternative I've seen. Built on Rust and WebGPU.")).toBe(false);
    expect(isFirstPartyBuilderText("We built this on Rust and WebGPU.")).toBe(true);
    expect(isFirstPartyBuilderText("I'm building a local-first design tool.")).toBe(true);
    expect(isFirstPartyBuilderText("Built by me and a cofounder to accelerate science.")).toBe(true);
  });

  it("distinguishes an old project resurface from a concrete new release", () => {
    const repository = { createdAt: "2025-01-01T00:00:00.000Z" };
    const packet = { repositories: [repository], preliminaryNewArtifact: false } as unknown as InvestigationPacket;
    const resurface = {
      text: "A great open-source security platform with automated testing.",
      publishedAt: Date.parse("2026-07-25T00:00:00.000Z"),
    } as FeedPost;
    const release = {
      ...resurface,
      text: "Today we released version 2.0 with automated testing.",
    };

    expect(hasEstablishedProjectResurface(resurface, packet)).toBe(true);
    expect(hasEstablishedProjectResurface(release, packet)).toBe(false);
    expect(hasEstablishedProjectResurface(resurface, { ...packet, preliminaryNewArtifact: true })).toBe(false);
  });
});
