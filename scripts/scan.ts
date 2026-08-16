import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

async function main() {
  const dayArg = process.argv.find((value) => /^\d{4}-\d{2}-\d{2}$/.test(value));
  const day = dayArg ?? new Date().toISOString().slice(0, 10);
  const [{ finishFeedScan, listPostsForAnalysis, startFeedScan, upsertFeedPosts }, { scanXFeed }, { runProductionReview }, { enrichCandidateProjectUrls }] = await Promise.all([
    import("../src/db"),
    import("../src/lib/x-session"),
    import("../src/lib/production-review"),
    import("../src/lib/project-url-enrichment"),
  ]);
  const scanId = startFeedScan(day);
  try {
    const { posts, supersededIds, candidateCount } = await scanXFeed(day);
    const saved = upsertFeedPosts(posts, supersededIds);
    const enrichment = await enrichCandidateProjectUrls(listPostsForAnalysis(day));
    const review = await runProductionReview(enrichment.posts);
    finishFeedScan(scanId, { status: "completed", foundCount: candidateCount, savedCount: review.published });
    console.log(`Scout ${day}: ${candidateCount} global X candidates, ${saved} normalized, ${enrichment.updated}/${enrichment.checked} missing links recovered, ${review.artifactInspected} pages inspected (${review.artifactCached} cached), ${review.preliminaryAnalyzed} newly screened (${review.preliminaryCached} cached), ${review.investigated} newly investigated (${review.investigatorCached} cached), ${review.webSearches} investigator web searches, ${review.screenshotsCaptured} screenshots, ${review.published} published, ${review.watched} watched, ${review.rejected} rejected, estimated $${(review.costMicros / 1_000_000).toFixed(4)} total analysis cost.`);
  } catch (error) {
    finishFeedScan(scanId, { status: "failed", error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

void main();
