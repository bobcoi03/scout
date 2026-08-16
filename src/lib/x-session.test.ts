import { describe, expect, it } from "vitest";

import { buildXSearchQuery, discoverySearches, isUsefulFeedPost, isWithinScanWindow, resolvePostExternalUrls, tweetToFeedPost } from "@/lib/x-session";

const baseTweet = {
  id: "123",
  username: "builder",
  name: "A Builder",
  text: "I built a tiny compiler and just released the complete source on GitHub.",
  hashtags: [], mentions: [], photos: [], thread: [], urls: ["https://github.com/builder/compiler"], videos: [],
  likes: 42, retweets: 7, replies: 3, views: 8000,
  timeParsed: new Date("2026-07-19T12:00:00Z"),
};

describe("X feed discovery", () => {
  it("adds date and noise-reduction operators", () => {
    const query = buildXSearchQuery("just launched", new Date("2026-07-01T00:00:00Z"), new Date("2026-07-09T00:00:00Z"));
    expect(query).toContain("since:2026-07-01");
    expect(query).toContain("until:2026-07-09");
    expect(query).toContain("-filter:replies");
    expect(query).toContain("-filter:retweets");
    expect(discoverySearches.every((item) => !item.query.includes("min_faves:"))).toBe(true);
    expect(discoverySearches.every((item) => !item.query.includes("filter:follows"))).toBe(true);
  });

  it("rejects X results outside the requested UTC day", () => {
    const start = new Date("2026-07-22T00:00:00.000Z");
    const end = new Date("2026-07-23T00:00:00.000Z");
    expect(isWithinScanWindow(start.getTime(), start, end)).toBe(true);
    expect(isWithinScanWindow(end.getTime() - 1, start, end)).toBe(true);
    expect(isWithinScanWindow(end.getTime(), start, end)).toBe(false);
  });

  it("admits low-engagement global launches without relying on a social graph", () => {
    const globalLaunch = { ...baseTweet, text: "Launch day. Needle, a new collaborative research workspace, is now live.", likes: 0 };
    expect(isUsefulFeedPost(globalLaunch, "New releases")).toBe(true);
    expect(tweetToFeedPost(globalLaunch, "New releases")?.id).toBe("123");
    expect(isUsefulFeedPost({ ...globalLaunch, text: "Acme raised a $10M seed round today." }, "New releases")).toBe(false);
  });

  it("normalizes a useful post with engagement ranking", () => {
    const result = tweetToFeedPost(baseTweet, "Open source");
    expect(result?.url).toBe("https://x.com/builder/status/123");
    expect(result?.category).toBe("Open source");
    expect(result?.externalUrls).toEqual(["https://github.com/builder/compiler"]);
    expect(result?.score).toBeGreaterThan(42);
  });

  it("keeps attributable project links and removes X/tracking URLs", async () => {
    await expect(resolvePostExternalUrls("No short links here.", [
      "https://example.com/project?utm_source=x#launch",
      "https://x.com/builder/status/123",
    ])).resolves.toEqual(["https://example.com/project"]);
  });

  it("uses the original post when a discovery tweet quotes a launch", () => {
    const result = tweetToFeedPost({
      ...baseTweet,
      id: "curator-1",
      username: "curator",
      text: "This is wild. Someone just open-sourced an entire deployment platform on GitHub.",
      quotedStatus: {
        ...baseTweet,
        id: "launch-1",
        username: "maker",
        name: "The Maker",
        text: "Introducing ShipIt, an open-source deployment platform.",
      },
    }, "Open source");

    expect(result).toMatchObject({
      id: "launch-1",
      username: "maker",
      displayName: "The Maker",
      url: "https://x.com/maker/status/launch-1",
    });
  });

  it("keeps a first-party builder post when its quote is supporting context", () => {
    const result = tweetToFeedPost({
      ...baseTweet,
      id: "builder-update",
      text: "I built and launched a new debugger based on this research.",
      quotedStatus: {
        ...baseTweet,
        id: "research-post",
        username: "researcher",
        text: "Our new paper studies compiler observability.",
      },
    }, "New releases");

    expect(result?.id).toBe("builder-update");
  });

  it("rejects fundraising and token promotion without rejecting real crypto products", () => {
    expect(isUsefulFeedPost({ ...baseTweet, text: "Acme raised a $5M seed round to expand the team" }, "New releases")).toBe(false);
    expect(isUsefulFeedPost({ ...baseTweet, text: "New token launch airdrop whitelist spot giveaway" }, "New releases")).toBe(false);
    expect(isUsefulFeedPost({
      ...baseTweet,
      text: "$Probaball We built the first sports prediction market on Solana. 60% of fees buy back our token. CA: CPvuUWhDAbPywfm7RpuWWMDbMqQ5YevpapfVww3zpump",
    }, "New releases")).toBe(false);
    expect(isUsefulFeedPost({
      ...baseTweet,
      text: "Introducing: $PROBA. Platform fees create token buybacks and staking rewards.",
    }, "New releases")).toBe(false);
    expect(isUsefulFeedPost({
      ...baseTweet,
      text: "I built and just launched a local-first app that costs $20/mo.",
    }, "New releases")).toBe(true);
    expect(isUsefulFeedPost({
      ...baseTweet,
      text: "We built and just launched Driftboard, a social trading app for perpetual markets. Here is the product demo.",
      videos: [{ id: "driftboard-demo", preview: "https://example.com/demo.jpg" }],
    }, "New releases")).toBe(true);
    expect(isUsefulFeedPost({
      ...baseTweet,
      text: "I built and released an open-source Solana wallet analytics dashboard. The GitHub repo is live today.",
    }, "Open source")).toBe(true);
    expect(isUsefulFeedPost({
      ...baseTweet,
      text: "We launched an Ethereum security product that monitors smart-contract exploits in real time.",
    }, "New releases")).toBe(true);
  });

  it("requires first-person evidence for demos and founders", () => {
    expect(isUsefulFeedPost({ ...baseTweet, text: "Someone just built the future of ticketing", videos: [{ id: "v", preview: "" }] }, "Product demos")).toBe(false);
    expect(isUsefulFeedPost({ ...baseTweet, text: "New startup idea: sell holidays to rich people" }, "New founders")).toBe(false);
    expect(isUsefulFeedPost({ ...baseTweet, text: "We are building a new company for compiler tooling" }, "New founders")).toBe(true);
  });

  it("admits the July 28 high-quality launch wording regressions", () => {
    const video = [{ id: "launch-video", preview: "https://pbs.twimg.com/preview.jpg" }];
    const examples = [
      "We’re launching MLX.fast: a public competition where anyone can collaborate and accelerate Laguna's MLX inference engine.",
      "A billion people produce the most valuable dataset every day. We’re recording it. Introducing @AttentionInc",
      "Introducing Orchid, the first assistant that actually gets you.",
      "A few months ago I had an idea to build a self-driving golf cart. Today, it’s finally real. iPhone app is now on TestFlight.",
      "AI transformed coding, science is next. Built by me and @berkbuilds to accelerate science with frontier AI.",
    ];
    for (const text of examples) {
      expect(isUsefulFeedPost({ ...baseTweet, text, videos: video }, "New releases"), text).toBe(true);
    }
    expect(discoverySearches.some((item) => item.query.includes("we're launching"))).toBe(true);
    expect(discoverySearches.some((item) => item.query.includes("built by me"))).toBe(true);
    expect(discoverySearches.length).toBeGreaterThanOrEqual(14);
    expect(discoverySearches.some((item) => item.query.includes("just open sourced"))).toBe(true);
    expect(discoverySearches.some((item) => item.query.includes("working prototype"))).toBe(true);
    const introducing = discoverySearches.find((item) => item.query.startsWith('"Introducing" filter:videos'));
    expect(introducing).toMatchObject({ topBudget: 20, latestBudget: 40, fetchLimit: 50 });
    expect(discoverySearches[0].query).toContain("finally real");
  });
});
