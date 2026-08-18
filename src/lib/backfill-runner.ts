import { scanRetryDelayMs, shiftUtcDay } from "@/lib/scan-schedule";

export type BackfillOptions = {
  from: string;
  to: string;
  delayMs?: number;
  force?: boolean;
};

export type BackfillSummary = {
  from: string;
  to: string;
  days: number;
  screenedCandidates: number;
  publishedBeforeDeduplication: number;
  costMicros: number;
  elapsedMs: number;
};

function validDay(value: string) {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(parsed.getTime())
    && parsed.toISOString().slice(0, 10) === value;
}

function daysDescending(from: string, to: string) {
  const days: string[] = [];
  for (let day = to; day >= from; day = shiftUtcDay(day, -1)) days.push(day);
  return days;
}

async function pause(ms: number) {
  if (ms > 0) await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runBackfill(options: BackfillOptions): Promise<BackfillSummary> {
  const today = new Date().toISOString().slice(0, 10);
  const delayMs = Math.max(0, Math.min(60_000, options.delayMs ?? 5_000));
  if (!validDay(options.from) || !validDay(options.to) || options.from > options.to || options.to > today) {
    throw new Error(`Invalid backfill range: ${options.from} to ${options.to}`);
  }

  const [db, x, production, projectUrls] = await Promise.all([
    import("@/db"),
    import("@/lib/x-session"),
    import("@/lib/production-review"),
    import("@/lib/project-url-enrichment"),
  ]);
  const days = daysDescending(options.from, options.to);
  const completed = options.force ? new Set<string>() : db.completedBackfillDays(options.from, options.to);
  let totalCandidates = 0;
  let totalAccepted = 0;
  let totalCostMicros = 0;
  const startedAt = Date.now();

  console.log(`Scout backfill: ${options.from} through ${options.to} (${days.length} days, newest first).`);
  for (let index = 0; index < days.length; index += 1) {
    const day = days[index];
    if (completed.has(day)) {
      console.log(`[${index + 1}/${days.length}] ${day}: already completed for the current analyst version; skipped.`);
      continue;
    }

    let completedDay = false;
    for (let attempt = 1; attempt <= 3 && !completedDay; attempt += 1) {
      const scanId = db.startFeedScan(day);
      const dayStartedAt = Date.now();
      console.log(`[${index + 1}/${days.length}] ${day}: scanning (attempt ${attempt}/3)…`);
      try {
        const result = await x.scanXFeed(day);
        const normalized = db.upsertFeedPosts(result.posts, result.supersededIds);
        const enrichment = await projectUrls.enrichCandidateProjectUrls(db.listPostsForAnalysis(day));
        const review = await production.runProductionReview(enrichment.posts);
        db.finishFeedScan(scanId, { status: "completed", foundCount: result.candidateCount, savedCount: review.published });
        totalCandidates += review.candidates;
        totalAccepted += review.published;
        totalCostMicros += review.costMicros;
        completedDay = true;
        console.log(`[${index + 1}/${days.length}] ${day}: ${result.candidateCount} global X candidates, ${normalized} normalized, ${review.preliminaryAnalyzed} newly screened (${review.preliminaryCached} cached), ${review.investigated} newly investigated (${review.investigatorCached} cached), ${review.published} published, $${(review.costMicros / 1_000_000).toFixed(4)}, ${((Date.now() - dayStartedAt) / 1000).toFixed(1)}s.`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        db.finishFeedScan(scanId, { status: "failed", error: message.slice(0, 500) });
        x.resetXSession();
        console.error(`[${index + 1}/${days.length}] ${day}: attempt ${attempt} failed: ${message}`);
        if (attempt === 3) throw error;
        const retryDelayMs = scanRetryDelayMs(error, attempt);
        console.log(`[${index + 1}/${days.length}] ${day}: retrying in ${Math.ceil(retryDelayMs / 1000)}s.`);
        await pause(retryDelayMs);
      }
    }
    if (index < days.length - 1) await pause(delayMs);
  }

  const elapsedMs = Date.now() - startedAt;
  console.log(`Scout backfill complete: ${totalCandidates} screened candidates, ${totalAccepted} published rows before cross-day project deduplication, $${(totalCostMicros / 1_000_000).toFixed(4)} analyzed cost, ${(elapsedMs / 60_000).toFixed(1)} minutes.`);
  return {
    from: options.from,
    to: options.to,
    days: days.length,
    screenedCandidates: totalCandidates,
    publishedBeforeDeduplication: totalAccepted,
    costMicros: totalCostMicros,
    elapsedMs,
  };
}
