import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

async function main() {
  const dayArg = process.argv.find((value) => /^\d{4}-\d{2}-\d{2}$/.test(value));
  const day = dayArg ?? new Date().toISOString().slice(0, 10);
  const postIndex = process.argv.indexOf("--post");
  const postId = postIndex >= 0 ? process.argv[postIndex + 1] : null;
  const [{ listPostsForAnalysis }, { runProductionReview }, { enrichCandidateProjectUrls }] = await Promise.all([
    import("../src/db"),
    import("../src/lib/production-review"),
    import("../src/lib/project-url-enrichment"),
  ]);
  const posts = listPostsForAnalysis(day);
  const selected = postId ? posts.filter((post) => post.id === postId) : posts;
  if (!selected.length) throw new Error(`No matching posts found for ${day}${postId ? ` and ${postId}` : ""}`);
  const enrichment = await enrichCandidateProjectUrls(selected);
  const result = await runProductionReview(enrichment.posts);
  console.log(
    `Scout ${day}: ${result.candidates} candidates, ${result.preliminaryAnalyzed} newly screened, `
    + `${result.investigated} newly investigated, ${result.published} published, ${result.watched} watched, ${result.rejected} rejected, `
    + `estimated $${(result.costMicros / 1_000_000).toFixed(4)} total analysis cost.`,
  );
}

void main();
