import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { FeedPost, InvestigatorDecision, InvestigatorVerdict, PostAnalysis } from "@/db";

let db: typeof import("@/db");
let temporaryDirectory: string;
const previousDatabasePath = process.env.SCOUT_DB_PATH;

function post(id: string, day: string): FeedPost {
  return {
    id,
    category: "New releases",
    url: `https://x.com/builder/status/${id}`,
    username: "builder",
    displayName: "Builder",
    text: `We launched ${id} today.`,
    publishedAt: Date.parse(`${day}T12:00:00.000Z`),
    likes: 10,
    reposts: 2,
    replies: 1,
    views: 1_000,
    mediaUrl: null,
    externalUrls: [`https://${id}.example.com`],
    score: 50,
    fetchedAt: Date.now(),
  };
}

function analysis(item: FeedPost): PostAnalysis {
  return {
    postId: item.id,
    contentHash: db.feedPostContentHash(item),
    promptVersion: db.ANALYSIS_VERSION,
    model: "gpt-5.4-nano",
    keep: true,
    signalType: "product_launch",
    relationship: "creator",
    artifactType: "product",
    newArtifact: true,
    analystScore: 70,
    investorRelevance: 70,
    seoProbability: 5,
    confidence: 70,
    projectKey: item.id,
    projectUrl: item.externalUrls[0],
    description: `${item.id} is a product.`,
    rejectionReason: null,
    evidence: ["First-party launch."],
    inputTokens: 100,
    outputTokens: 20,
    costMicros: 45,
    analyzedAt: Date.now(),
  };
}

function verdict(item: FeedPost, decision: InvestigatorDecision): InvestigatorVerdict {
  return {
    postId: item.id,
    contentHash: db.feedPostContentHash(item),
    version: db.INVESTIGATOR_VERSION,
    model: "gpt-5.4-mini+gpt-5.4",
    decision,
    sourceRole: "creator",
    officialSourceUrl: item.url,
    canonicalEventKey: `site:${item.id}.example.com`,
    sourceAuthority: 80,
    founderCare: 80,
    productSubstance: 80,
    marketPotential: 80,
    differentiation: 75,
    credibility: 80,
    evidenceConfidence: 85,
    investorRelevance: 82,
    worthFiveMinutes: decision === "publish" ? 91 : 30,
    projectKey: item.id,
    projectUrl: item.externalUrls[0],
    description: `${item.id} was investigated.`,
    rejectionReason: decision === "reject" ? "Not strong enough." : null,
    slopFlags: [],
    evidence: ["Investigated evidence."],
    inputTokens: 200,
    outputTokens: 50,
    costMicros: 250,
    webSearches: 0,
    analyzedAt: Date.now(),
  };
}

beforeAll(async () => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "scout-curation-test-"));
  process.env.SCOUT_DB_PATH = path.join(temporaryDirectory, "scout.db");
  delete (globalThis as typeof globalThis & { scoutFeedSqlite?: unknown }).scoutFeedSqlite;
  vi.resetModules();
  db = await import("@/db");
});

afterAll(() => {
  if (previousDatabasePath == null) delete process.env.SCOUT_DB_PATH;
  else process.env.SCOUT_DB_PATH = previousDatabasePath;
  delete (globalThis as typeof globalThis & { scoutFeedSqlite?: unknown }).scoutFeedSqlite;
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

describe("forward-only investigator curation", () => {
  it("uses investigator decisions only for successfully completed investigator scan days", () => {
    const legacy = post("legacy", "2026-07-20");
    const published = post("published", "2026-07-21");
    const rejected = post("rejected", "2026-07-21");
    const failed = post("failed", "2026-07-22");
    const posts = [legacy, published, rejected, failed];

    db.upsertFeedPosts(posts);
    db.savePostAnalyses(posts.map(analysis));
    db.saveInvestigatorVerdicts([
      verdict(legacy, "reject"),
      verdict(published, "publish"),
      verdict(rejected, "reject"),
      verdict(failed, "reject"),
    ]);

    const legacyScan = db.startFeedScan("2026-07-20", null);
    db.finishFeedScan(legacyScan, { status: "completed" });
    const productionScan = db.startFeedScan("2026-07-21");
    db.finishFeedScan(productionScan, { status: "completed", savedCount: 1 });
    const failedScan = db.startFeedScan("2026-07-22");
    db.finishFeedScan(failedScan, { status: "failed" });

    expect(db.listProjectRows("2026-07-20", "2026-07-22", 20, "curated").map((row) => row.postId).sort())
      .toEqual(["failed", "legacy", "published"]);
    expect(db.listFeedPosts("2026-07-21", 20).map((item) => item.id)).toEqual(["published"]);

    const allNewDayRows = db.listProjectRows("2026-07-21", "2026-07-21", 20, "all");
    expect(allNewDayRows.find((row) => row.postId === "published")).toMatchObject({
      keep: true,
      model: "gpt-5.4-mini+gpt-5.4",
      analystScore: 91,
      confidence: 85,
    });
    expect(allNewDayRows.find((row) => row.postId === "rejected")?.keep).toBe(false);

    // The scheduler still treats both old and new completed days as complete,
    // so deploying the curator never triggers a historical backfill.
    expect([...db.completedBackfillDays("2026-07-20", "2026-07-22")].sort())
      .toEqual(["2026-07-20", "2026-07-21"]);
  });
});
