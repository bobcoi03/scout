import type { FeedPost } from "@/db";
import { analyzeFeedPosts } from "@/lib/analyst";
import { inspectFeedArtifacts } from "@/lib/artifact-inspector";
import { env } from "@/lib/env";
import { runInvestigatorPipeline } from "@/lib/investigator";

export type ProductionReviewRun = {
  candidates: number;
  artifactInspected: number;
  artifactCached: number;
  preliminaryAnalyzed: number;
  preliminaryCached: number;
  preliminaryAccepted: number;
  investigatorCandidates: number;
  packetsBuilt: number;
  packetsCached: number;
  screenshotsCaptured: number;
  investigated: number;
  investigatorCached: number;
  webSearches: number;
  judged: number;
  published: number;
  watched: number;
  rejected: number;
  inputTokens: number;
  outputTokens: number;
  costMicros: number;
};

/**
 * The live production review path:
 * 1. cheaply inspect and classify the broad discovery pool;
 * 2. deeply investigate only the strongest bounded shortlist;
 * 3. publish only the investigator's final daily selections.
 */
export async function runProductionReview(posts: FeedPost[]): Promise<ProductionReviewRun> {
  const candidates = posts.slice(0, env.analystDailyCandidateLimit);
  const artifacts = await inspectFeedArtifacts(candidates);
  const preliminary = await analyzeFeedPosts(candidates, artifacts.evidence);
  const investigator = await runInvestigatorPipeline(candidates);

  return {
    candidates: candidates.length,
    artifactInspected: artifacts.inspected,
    artifactCached: artifacts.cached,
    preliminaryAnalyzed: preliminary.analyzed,
    preliminaryCached: preliminary.cached,
    preliminaryAccepted: preliminary.accepted,
    investigatorCandidates: investigator.candidates,
    packetsBuilt: investigator.packetsBuilt,
    packetsCached: investigator.packetsCached,
    screenshotsCaptured: investigator.screenshotsCaptured,
    investigated: investigator.analyzed,
    investigatorCached: investigator.cached,
    webSearches: investigator.webSearches,
    judged: investigator.judged,
    published: investigator.published,
    watched: investigator.watched,
    rejected: investigator.rejected,
    inputTokens: preliminary.inputTokens + investigator.inputTokens,
    outputTokens: preliminary.outputTokens + investigator.outputTokens,
    costMicros: preliminary.costMicros + investigator.costMicros,
  };
}
