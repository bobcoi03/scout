import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

function postId(value: string) {
  const match = /(?:x|twitter)\.com\/[^/]+\/status\/(\d+)/i.exec(value);
  return match?.[1] ?? (/^\d+$/.test(value) ? value : null);
}

function postUsername(value: string) {
  return /(?:x|twitter)\.com\/([^/]+)\/status\/\d+/i.exec(value)?.[1] ?? null;
}

async function main() {
  const scanDayIndex = process.argv.indexOf("--scan-day");
  const scanDay = scanDayIndex >= 0 ? process.argv[scanDayIndex + 1] : null;
  const probeQueryIndex = process.argv.indexOf("--probe-query");
  const probeQuery = probeQueryIndex >= 0 ? process.argv[probeQueryIndex + 1] : null;
  const probeSearches = process.argv.includes("--probe-searches");
  const probeOnly = process.argv.includes("--probe-only");
  const skipPosts = process.argv.includes("--skip-posts");
  const values = process.argv.slice(2).filter((value, index, all) =>
    value !== "--scan-day" && value !== "--probe-query" && value !== "--probe-searches" && value !== "--probe-only" && value !== "--skip-posts"
    && all[index - 1] !== "--scan-day" && all[index - 1] !== "--probe-query");
  const ids = [...new Set(values.map(postId).filter((value): value is string => Boolean(value)))];
  if (!ids.length) throw new Error("Pass one or more X post URLs or post IDs");
  const { discoverySearches, getXPostById, isUsefulFeedPost, probeXLatestSearch, scanXFeed } = await import("../src/lib/x-session");
  const fetched: Array<{ id: string; username: string }> = [];
  if (probeOnly) {
    for (const value of values) {
      const id = postId(value);
      const username = postUsername(value);
      if (id && username) fetched.push({ id, username });
    }
  }
  for (const id of probeOnly || skipPosts ? [] : ids) {
    const tweet = await getXPostById(id);
    if (!tweet?.id) {
      console.log(JSON.stringify({ id, error: "Post not found" }));
      continue;
    }
    fetched.push({ id: tweet.id, username: tweet.username ?? "" });
    const matchedCategories = [...new Set(discoverySearches
      .filter((search) => isUsefulFeedPost(tweet, search.category))
      .map((search) => search.category))];
    console.log(JSON.stringify({
      id,
      url: tweet.permanentUrl ?? `https://x.com/${tweet.username}/status/${id}`,
      username: tweet.username,
      name: tweet.name,
      publishedAt: tweet.timeParsed?.toISOString() ?? null,
      text: tweet.text,
      likes: tweet.likes ?? 0,
      reposts: tweet.retweets ?? 0,
      replies: tweet.replies ?? 0,
      views: tweet.views ?? 0,
      externalUrls: tweet.urls ?? [],
      videos: tweet.videos?.length ?? 0,
      photos: tweet.photos?.length ?? 0,
      isReply: Boolean(tweet.isReply),
      isRetweet: Boolean(tweet.isRetweet),
      isQuote: Boolean(tweet.isQuoted),
      matchedPostFilters: matchedCategories,
    }, null, 2));
  }
  if (scanDay) {
    if (!probeOnly) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(scanDay)) throw new Error(`Invalid --scan-day: ${scanDay}`);
      const result = await scanXFeed(scanDay);
      const found = new Set(result.posts.map((post) => post.id));
      console.log(JSON.stringify({
        scanDay,
        searchedCandidates: result.candidateCount,
        normalizedPosts: result.posts.length,
        requested: ids.map((id) => ({ id, found: found.has(id) })),
      }, null, 2));
    }
    if (probeSearches) {
      const probes = probeQuery ? [probeQuery] : [
        '"we’re launching"',
        '"Introducing" filter:videos',
        '"finally real" filter:videos',
        '"built by me" filter:videos',
        ...(fetched.length ? [`(${fetched.map((item) => `from:${item.username}`).join(" OR ")})`] : []),
      ];
      for (const query of probes) {
        const results = await probeXLatestSearch(query, scanDay, 100);
        const found = new Set(results.map((item) => item.id));
        console.log(JSON.stringify({
          query,
          returned: results.length,
          requested: ids.map((id) => {
            const rank = results.findIndex((item) => item.id === id);
            return { id, found: found.has(id), latestRank: rank >= 0 ? rank + 1 : null };
          }),
        }, null, 2));
      }
    }
  }
}

void main();
