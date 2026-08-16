import { loadEnvConfig } from "@next/env";
import fs from "node:fs/promises";
import path from "node:path";

loadEnvConfig(process.cwd());

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function usd(micros: number) {
  return `$${(micros / 1_000_000).toFixed(4)}`;
}

function shortText(value: string | null | undefined, max = 120) {
  const normalized = (value ?? "").replace(/\s+/g, " ").trim();
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}

async function main() {
  const requestedDays = Math.max(1, Math.min(7, Number(argument("--days") ?? 3) || 3));
  const force = process.argv.includes("--force");
  const refreshEvidence = process.argv.includes("--refresh-evidence");
  const outputTag = argument("--output-tag")?.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || null;
  const [db, investigator] = await Promise.all([
    import("../src/db"),
    import("../src/lib/investigator"),
  ]);
  const explicitDays = process.argv.filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value));
  const days = explicitDays.length ? explicitDays : db.recentCompletedScanDays(requestedDays);
  if (!days.length) throw new Error("No completed Scout scan days were found");

  const reports: Array<{
    day: string;
    posts: number;
    oldCostMicros: number;
    newCostMicros: number;
    estimatedNewProductionCostMicros: number;
    oldSelected: Array<Record<string, unknown>>;
    newPublished: Array<Record<string, unknown>>;
    removed: Array<Record<string, unknown>>;
    added: Array<Record<string, unknown>>;
    retained: Array<Record<string, unknown>>;
    watchlist: Array<Record<string, unknown>>;
    run: Omit<Awaited<ReturnType<typeof investigator.runInvestigatorPipeline>>, "verdicts">;
  }> = [];

  for (const [index, day] of days.entries()) {
    console.log(`[${index + 1}/${days.length}] ${day}: building evidence packets and running the investigator…`);
    const posts = db.listPostsForAnalysis(day);
    if (!posts.length) {
      console.log(`[${index + 1}/${days.length}] ${day}: no stored candidates; skipped.`);
      continue;
    }
    const oldAnalyses = new Map(posts.map((post) => [post.id, db.getCachedPostAnalysis(post)]));
    const oldSelectedPosts = posts.filter((post) => oldAnalyses.get(post.id)?.keep);
    const run = await investigator.runInvestigatorPipeline(posts, { force, refreshEvidence });
    const verdictById = new Map(run.verdicts.map((verdict) => [verdict.postId, verdict]));
    const publishedPosts = posts
      .filter((post) => verdictById.get(post.id)?.decision === "publish")
      .sort((a, b) => (verdictById.get(b.id)?.worthFiveMinutes ?? 0) - (verdictById.get(a.id)?.worthFiveMinutes ?? 0));
    const oldIds = new Set(oldSelectedPosts.map((post) => post.id));
    const newIds = new Set(publishedPosts.map((post) => post.id));
    const describeOld = (post: typeof posts[number]) => {
      const analysis = oldAnalyses.get(post.id)!;
      return {
        postId: post.id,
        project: analysis?.projectKey,
        author: `@${post.username}`,
        postUrl: post.url,
        projectUrl: analysis?.projectUrl,
        oldScore: analysis?.analystScore,
        likes: post.likes,
        text: shortText(post.text),
      };
    };
    const describeNew = (post: typeof posts[number]) => {
      const verdict = verdictById.get(post.id)!;
      return {
        postId: post.id,
        project: verdict.projectKey,
        author: `@${post.username}`,
        postUrl: post.url,
        officialSourceUrl: verdict.officialSourceUrl,
        projectUrl: verdict.projectUrl,
        decision: verdict.decision,
        worthFiveMinutes: verdict.worthFiveMinutes,
        sourceRole: verdict.sourceRole,
        scores: {
          care: verdict.founderCare,
          substance: verdict.productSubstance,
          market: verdict.marketPotential,
          differentiation: verdict.differentiation,
          credibility: verdict.credibility,
          evidence: verdict.evidenceConfidence,
        },
        slopFlags: verdict.slopFlags,
        reason: verdict.rejectionReason ?? verdict.evidence[0] ?? null,
        likes: post.likes,
        text: shortText(post.text),
      };
    };
    const removed = oldSelectedPosts.filter((post) => !newIds.has(post.id)).map((post) => ({
      ...describeOld(post),
      newVerdict: verdictById.has(post.id) ? describeNew(post) : { decision: "not_in_top_investigation_set" },
    }));
    const added = publishedPosts.filter((post) => !oldIds.has(post.id)).map(describeNew);
    const retained = publishedPosts.filter((post) => oldIds.has(post.id)).map(describeNew);
    const watchlist = posts
      .filter((post) => verdictById.get(post.id)?.decision === "watch")
      .sort((a, b) => (verdictById.get(b.id)?.worthFiveMinutes ?? 0) - (verdictById.get(a.id)?.worthFiveMinutes ?? 0))
      .slice(0, 10)
      .map(describeNew);
    const oldCostMicros = [...oldAnalyses.values()].reduce((sum, analysis) => sum + (analysis?.costMicros ?? 0), 0);
    // Production would retain the inexpensive Nano discovery pass, estimated from
    // Scout's observed recent mean of roughly 350 microdollars per new candidate.
    const estimatedNanoCostMicros = posts.length * 350;
    const runSummary = {
      candidates: run.candidates,
      packetsBuilt: run.packetsBuilt,
      packetsCached: run.packetsCached,
      screenshotsCaptured: run.screenshotsCaptured,
      analyzed: run.analyzed,
      cached: run.cached,
      webSearches: run.webSearches,
      judged: run.judged,
      published: run.published,
      watched: run.watched,
      rejected: run.rejected,
      inputTokens: run.inputTokens,
      outputTokens: run.outputTokens,
      costMicros: run.costMicros,
    };
    reports.push({
      day,
      posts: posts.length,
      oldCostMicros,
      newCostMicros: run.costMicros,
      estimatedNewProductionCostMicros: estimatedNanoCostMicros + run.costMicros,
      oldSelected: oldSelectedPosts.map(describeOld),
      newPublished: publishedPosts.map(describeNew),
      removed,
      added,
      retained,
      watchlist,
      run: runSummary,
    });
    console.log(
      `[${index + 1}/${days.length}] ${day}: old ${oldSelectedPosts.length}, new ${publishedPosts.length}, `
      + `${retained.length} retained, ${removed.length} removed, ${added.length} added, investigator ${usd(run.costMicros)}.`,
    );
  }

  const totals = reports.reduce((accumulator, report) => ({
    posts: accumulator.posts + report.posts,
    oldSelected: accumulator.oldSelected + report.oldSelected.length,
    newPublished: accumulator.newPublished + report.newPublished.length,
    retained: accumulator.retained + report.retained.length,
    removed: accumulator.removed + report.removed.length,
    added: accumulator.added + report.added.length,
    oldCostMicros: accumulator.oldCostMicros + report.oldCostMicros,
    newCostMicros: accumulator.newCostMicros + report.newCostMicros,
    estimatedNewProductionCostMicros: accumulator.estimatedNewProductionCostMicros + report.estimatedNewProductionCostMicros,
  }), {
    posts: 0, oldSelected: 0, newPublished: 0, retained: 0, removed: 0, added: 0,
    oldCostMicros: 0, newCostMicros: 0, estimatedNewProductionCostMicros: 0,
  });

  const lines = [
    "# Scout investigator comparison",
    "",
    `Generated ${new Date().toISOString()}. Production analysis was read-only; investigator results use version ${db.INVESTIGATOR_VERSION}.`,
    "",
    "## Summary",
    "",
    "| Days | Candidates | Old published | New published | Retained | Removed | Added | Old model cost | Estimated new pipeline cost |",
    "| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    `| ${reports.length} | ${totals.posts} | ${totals.oldSelected} | ${totals.newPublished} | ${totals.retained} | ${totals.removed} | ${totals.added} | ${usd(totals.oldCostMicros)} | ${usd(totals.estimatedNewProductionCostMicros)} |`,
    "",
    "The estimated new production cost combines the observed Nano first-pass average with the measured investigator calls. Site, profile, repository, screenshot, and local video-frame collection have no OpenAI token charge.",
    "",
  ];

  for (const report of reports) {
    lines.push(
      `## ${report.day}`,
      "",
      `${report.posts} candidates · old ${report.oldSelected.length} · new ${report.newPublished.length} · measured investigator ${usd(report.newCostMicros)} · estimated complete new pipeline ${usd(report.estimatedNewProductionCostMicros)}`,
      "",
      "### New briefing",
      "",
    );
    if (!report.newPublished.length) lines.push("_No item cleared the final investor bar._", "");
    for (const item of report.newPublished) {
      lines.push(
        `- **${item.project ?? "Unnamed project"}** — ${item.author} — ${item.worthFiveMinutes}/100 — ${item.sourceRole}`,
        `  ${item.reason ?? ""}`,
        `  Official artifact/source: ${item.officialSourceUrl ?? item.projectUrl ?? item.postUrl}`,
        `  Discovery post: ${item.postUrl}`,
      );
    }
    lines.push("", "### Removed from the production selection", "");
    if (!report.removed.length) lines.push("_None._", "");
    for (const item of report.removed) {
      const verdict = item.newVerdict as Record<string, unknown>;
      lines.push(
        `- **${item.project ?? "Unnamed project"}** — ${item.author} — old ${item.oldScore ?? "?"}, new ${verdict.worthFiveMinutes ?? verdict.decision ?? "not reviewed"}`,
        `  ${String(verdict.reason ?? "")}`,
        `  Slop flags: ${Array.isArray(verdict.slopFlags) && verdict.slopFlags.length ? verdict.slopFlags.join(", ") : "none"}`,
        `  ${item.postUrl}`,
      );
    }
    lines.push("", "### Added by the investigator", "");
    if (!report.added.length) lines.push("_None._", "");
    for (const item of report.added) {
      lines.push(
        `- **${item.project ?? "Unnamed project"}** — ${item.author} — ${item.worthFiveMinutes}/100`,
        `  ${item.reason ?? ""}`,
        `  Official artifact/source: ${item.officialSourceUrl ?? item.projectUrl ?? item.postUrl}`,
        `  Discovery post: ${item.postUrl}`,
      );
    }
    lines.push("", "### Watchlist", "");
    if (!report.watchlist.length) lines.push("_None._", "");
    for (const item of report.watchlist) {
      lines.push(`- **${item.project ?? "Unnamed project"}** — ${item.worthFiveMinutes}/100 — ${item.reason ?? ""}`);
    }
    lines.push("");
  }

  const outputDirectory = path.resolve(process.cwd(), "outputs");
  await fs.mkdir(outputDirectory, { recursive: true });
  const label = [...days].sort().join("_to_");
  const taggedLabel = outputTag ? `${label}-${outputTag}` : label;
  const markdownPath = path.join(outputDirectory, `investigator-comparison-${taggedLabel}.md`);
  const jsonPath = path.join(outputDirectory, `investigator-comparison-${taggedLabel}.json`);
  await Promise.all([
    fs.writeFile(markdownPath, `${lines.join("\n")}\n`),
    fs.writeFile(jsonPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), totals, reports }, null, 2)}\n`),
  ]);
  console.log(`Comparison written to ${markdownPath}`);
  console.log(`Machine-readable results written to ${jsonPath}`);
}

void main();
