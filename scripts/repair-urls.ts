import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

function arg(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const to = arg("--to") ?? new Date().toISOString().slice(0, 10);
  const from = arg("--from") ?? new Date(Date.parse(`${to}T00:00:00.000Z`) - 14 * 86_400_000).toISOString().slice(0, 10);
  const [db, x, projectUrls] = await Promise.all([
    import("../src/db"),
    import("../src/lib/x-session"),
    import("../src/lib/project-url-enrichment"),
  ]);
  const rows = db.listProjectRows(from, to, 5000, "curated");
  let repaired = 0;
  for (let index = 0; index < rows.length; index += 8) {
    await Promise.all(rows.slice(index, index + 8).map(async (row) => {
      const urls = await x.resolvePostExternalUrls(row.postText, row.externalUrls);
      if (urls.join("\n") === row.externalUrls.join("\n")) return;
      db.updateFeedPostExternalUrls(row.postId, urls);
      repaired += 1;
    }));
  }

  const enrichment = await projectUrls.enrichCuratedProjectUrls(from, to);
  console.log(`Repaired post links for ${repaired}/${rows.length} curated rows and ${enrichment.updated} thread/profile links; ${enrichment.remaining} rows have no confidently attributable public project URL.`);
}

void main();
