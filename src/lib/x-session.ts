import type { Tweet } from "@the-convocation/twitter-scraper";

import type { FeedCategory, FeedPost } from "@/db";
import { env, xSessionConfigured } from "@/lib/env";
import { isCryptoPromotionText } from "@/lib/signal-filters";

const allowedXHosts = new Set(["x.com", "api.x.com", "twitter.com", "api.twitter.com"]);
const fundingPattern = /\b(raises?|raised|funding round|financing round|seed round|series [a-z]|valuation|backed by|secured funding)\b/i;
const spamPattern = /\b(interview questions|course sale)\b/i;
const newsPattern = /\b(breaking|just in|according to reports?|weekly roundup|top \d+ tools?|must-know|bookmark this list|x spaces|join the conversation)\b/i;
const builderLaunchPattern = /\b(i built|we built|built by (?:me|us)|i made|we made|i launched|we launched|i just launched|we just launched|we(?:['’]re| are) launching|shipping today|just shipped|launch day|now live|available today|introducing|finally real|now on testflight|open(?:ing)? (?:the )?beta|join (?:the|our) waitlist)\b/i;
const concreteReleasePattern = /\b(?:announcing|unveiled?|launch(?:es|ed|ing)?|released?|ships?|now available|open[ -]?sourced?)\b/i;
const builderDemoPattern = /\b(i built|we built|built by (?:me|us)|i made|we made|our (?:new )?(?:demo|prototype|product)|here(?:'s| is) (?:a|the|our) demo|demoing|introducing|finally real|now on testflight|prototype|my submission|our submission|just shipped)\b/i;
const founderCommitmentPattern = /\b(starting (?:a|my|our) company|i(?:'m| am) building|we(?:'re| are) building|i founded|we founded|building (?:my|our) startup|my new startup|our new startup)\b/i;
const firstPartyPattern = /\b(i|i'm|i am|we|we're|we are|my|our)\b/i;
const builderActionPattern = /\b(built|made|launched|launching|released|releasing|open[ -]?sourced|shipped|shipping|introduc(?:e|ing)|wired|added|created|developed)\b/i;

type XScraper = InstanceType<typeof import("@the-convocation/twitter-scraper").Scraper>;

export const discoverySearches: Array<{
  category: FeedCategory;
  query: string;
  topBudget?: number;
  latestBudget?: number;
  fetchLimit?: number;
}> = [
  {
    category: "Product demos",
    query: '("finally real" OR "built by me" OR "built by us" OR "now on TestFlight") filter:videos -jobs -hiring',
  },
  {
    category: "New releases",
    query: '"Introducing" filter:videos (AI OR assistant OR app OR product OR startup OR platform OR software OR tool OR company OR model OR data OR dataset) -jobs -hiring -music -trailer -episode',
    topBudget: 20,
    latestBudget: 40,
    fetchLimit: 50,
  },
  {
    category: "New releases",
    query: '("we’re launching" OR "we\'re launching" OR "we are launching") (AI OR model OR inference OR API OR software OR app OR product OR platform OR tool OR open-source OR competition) -jobs -hiring',
  },
  {
    category: "New releases",
    query: '("I built" OR "we built" OR "built by me" OR "built by us" OR "I made" OR "we made" OR "I launched" OR "we launched" OR "we’re launching" OR "we\'re launching" OR "we are launching" OR "just launched" OR "launching today" OR "finally real" OR "now on TestFlight" OR "just shipped") -jobs -hiring',
  },
  {
    category: "Product demos",
    query: '("I built" OR "we built" OR "I made" OR "we made" OR "built by me" OR "built by us") filter:videos (AI OR app OR product OR tool OR software OR hardware OR robot OR platform) -jobs -hiring',
  },
  {
    category: "New releases",
    query: '("shipping today" OR "shipped today" OR "launched today" OR "launching today" OR "released today") filter:links (app OR product OR tool OR API OR model OR platform OR software) -jobs -hiring',
  },
  {
    category: "New releases",
    query: '("launch day" OR "now live" OR "available today" OR "introducing" OR "opening beta" OR "join the waitlist") (app OR product OR tool OR platform OR startup OR software) -jobs -hiring',
  },
  {
    category: "New releases",
    query: '("announcing" OR "unveiled" OR "launches today" OR "released today" OR "now available") (app OR product OR developer OR API OR model OR platform OR software) -jobs -hiring',
  },
  {
    category: "Open source",
    query: '("open sourced" OR "open-source" OR "released on GitHub" OR "GitHub repo" OR "source code is live") (built OR releasing OR launched OR introducing)',
  },
  {
    category: "Open source",
    query: '("just open sourced" OR "we open sourced" OR "I open sourced" OR "now open source") filter:links (AI OR agent OR developer OR database OR framework OR infrastructure OR library OR model OR tool)',
  },
  {
    category: "Product demos",
    query: '("built this" OR "we built" OR "demoing" OR "product demo" OR prototype) filter:videos -jobs -hiring',
  },
  {
    category: "Product demos",
    query: '("here’s a demo" OR "here is a demo" OR "demo is live" OR "working prototype" OR "first prototype") filter:videos (app OR product OR tool OR robot OR software OR hardware) -jobs -hiring',
  },
  {
    category: "New releases",
    query: '("public beta" OR "open beta" OR "early access is live" OR "TestFlight" OR "App Store") ("I built" OR "we built" OR "our app" OR "our product") -jobs -hiring',
  },
  {
    category: "New releases",
    query: '("new API" OR "new SDK" OR "new model" OR "new developer tool" OR "new database") ("we built" OR "we’re launching" OR "we\'re launching" OR "introducing" OR "now available") -jobs -hiring',
  },
  {
    category: "New founders",
    query: '("starting a company" OR "I am building" OR "I\'m building" OR "we are building" OR "new startup") (founder OR startup OR company OR product) -jobs -hiring',
  },
];

let scraperPromise: Promise<XScraper> | null = null;

export class XSessionError extends Error {
  constructor(operation: string, cause: unknown) {
    super(`X session ${operation} failed: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
    this.name = "XSessionError";
  }
}

function requestUrl(input: RequestInfo | URL) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function validateXDestination(input: RequestInfo | URL) {
  const url = new URL(requestUrl(input));
  if (url.protocol !== "https:" || !allowedXHosts.has(url.hostname)) {
    throw new Error(`Blocked unexpected twitter-scraper destination: ${url.hostname}`);
  }
}

async function createScraper(): Promise<XScraper> {
  if (!xSessionConfigured()) throw new Error("X session discovery is not configured");

  // twitter-scraper has a debug branch that logs part of ct0. Import it with
  // debug disabled and never expose cookie material outside this module.
  const previousDebug = process.env.DEBUG;
  process.env.DEBUG = "";
  const { ErrorRateLimitStrategy, Scraper } = await import("@the-convocation/twitter-scraper");
  if (previousDebug === undefined) delete process.env.DEBUG;
  else process.env.DEBUG = previousDebug;

  const safeFetch = (input: RequestInfo | URL, init?: RequestInit) => {
    validateXDestination(input);
    const timeout = AbortSignal.timeout(25_000);
    const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    return fetch(input, { ...init, signal });
  };

  const scraper = new Scraper({
    fetch: safeFetch as never,
    rateLimitStrategy: new ErrorRateLimitStrategy(),
    transform: {
      request(input, init) {
        validateXDestination(input as RequestInfo | URL);
        return [input, init];
      },
    },
    experimental: { xClientTransactionId: false, xpff: false },
  });

  await scraper.setCookies([
    `ct0=${env.xCt0}; Domain=x.com; Path=/; Secure; SameSite=Lax`,
    `auth_token=${env.xAuthToken}; Domain=x.com; Path=/; Secure; HttpOnly; SameSite=Lax`,
  ]);
  if (!(await scraper.isLoggedIn())) throw new Error("X session cookies are missing or invalid");
  return scraper;
}

async function getScraper() {
  if (!scraperPromise) scraperPromise = createScraper().catch((error) => {
    scraperPromise = null;
    throw error;
  });
  return scraperPromise;
}

export function resetXSession() {
  scraperPromise = null;
}

export async function getXPostById(id: string) {
  try {
    return await (await getScraper()).getTweet(id);
  } catch (error) {
    throw new XSessionError("post lookup", error);
  }
}

export async function getXProfile(username: string) {
  try {
    return await (await getScraper()).getProfile(username);
  } catch (error) {
    throw new XSessionError("profile lookup", error);
  }
}

export async function getXRecentPosts(username: string, limit = 12) {
  try {
    const posts: Array<{ text: string; likes: number; reposts: number; publishedAt: string | null }> = [];
    for await (const tweet of (await getScraper()).getTweets(username, Math.max(1, Math.min(20, limit)))) {
      if (!tweet.text || tweet.isRetweet) continue;
      posts.push({
        text: tweet.text.replace(/\s+/g, " ").trim().slice(0, 500),
        likes: tweet.likes ?? 0,
        reposts: tweet.retweets ?? 0,
        publishedAt: tweet.timeParsed?.toISOString() ?? null,
      });
      if (posts.length >= limit) break;
    }
    return posts;
  } catch (error) {
    throw new XSessionError("profile timeline lookup", error);
  }
}

export async function probeXLatestSearch(query: string, day: string, limit = 50) {
  try {
    const { SearchMode } = await import("@the-convocation/twitter-scraper");
    const startDate = new Date(`${day}T00:00:00.000Z`);
    if (!Number.isFinite(startDate.getTime()) || startDate.toISOString().slice(0, 10) !== day) throw new Error(`Invalid X probe day: ${day}`);
    const endDate = new Date(startDate.getTime() + 86_400_000);
    const results: Array<{ id: string; username: string; text: string }> = [];
    for await (const tweet of (await getScraper()).searchTweets(
      buildXSearchQuery(query, startDate, endDate),
      Math.max(1, Math.min(100, limit)),
      SearchMode.Latest,
    )) {
      if (!tweet.id || !tweet.username || !tweet.text) continue;
      results.push({ id: tweet.id, username: tweet.username, text: tweet.text.replace(/\s+/g, " ").trim().slice(0, 300) });
      if (results.length >= limit) break;
    }
    return results;
  } catch (error) {
    throw new XSessionError("search probe", error);
  }
}

export async function getXThreadExternalUrls(postId: string, username: string, existing: string[] = []) {
  try {
    const { SearchMode } = await import("@the-convocation/twitter-scraper");
    const scraper = await getScraper();
    const urls = new Set(await resolvePostExternalUrls("", existing));
    const normalizedUsername = username.toLowerCase();
    const query = `conversation_id:${postId} from:${username} filter:replies`;
    for await (const reply of scraper.searchTweets(query, 12, SearchMode.Latest)) {
      if (reply.username?.toLowerCase() !== normalizedUsername || (reply.conversationId && reply.conversationId !== postId)) continue;
      const replyUrls = await resolvePostExternalUrls(reply.text ?? "", externalUrls(reply));
      for (const url of replyUrls) urls.add(url);
    }
    return [...urls].slice(0, 8);
  } catch (error) {
    throw new XSessionError("thread link lookup", error);
  }
}

function isoDay(value: Date) {
  return value.toISOString().slice(0, 10);
}

export function buildXSearchQuery(query: string, startDate: Date, endDate: Date) {
  const parts = [query.trim()];
  if (!/(^|\s)since:\d{4}-\d{2}-\d{2}/i.test(query)) parts.push(`since:${isoDay(startDate)}`);
  if (!/(^|\s)until:\d{4}-\d{2}-\d{2}/i.test(query)) parts.push(`until:${isoDay(endDate)}`);
  if (!/filter:replies/i.test(query)) parts.push("-filter:replies");
  if (!/filter:retweets/i.test(query)) parts.push("-filter:retweets");
  return parts.join(" ");
}

export function isWithinScanWindow(publishedAt: number, startDate: Date, endDate: Date) {
  return publishedAt >= startDate.getTime() && publishedAt < endDate.getTime();
}

function passesHardDiscoveryFilters(tweet: Tweet) {
  const text = tweet.text?.replace(/https?:\/\/t\.co\/\w+/gi, " ").replace(/\s+/g, " ").trim() ?? "";
  if (!tweet.id || !tweet.username || text.length < 28 || tweet.isReply || tweet.isRetweet) return false;
  if (fundingPattern.test(text) || spamPattern.test(text) || isCryptoPromotionText(text) || newsPattern.test(text)) return false;
  return true;
}

export function isUsefulFeedPost(tweet: Tweet, category: FeedCategory) {
  if (!passesHardDiscoveryFilters(tweet)) return false;
  const text = tweet.text?.replace(/https?:\/\/t\.co\/\w+/gi, " ").replace(/\s+/g, " ").trim() ?? "";
  if (category === "New releases" && !builderLaunchPattern.test(text) && !concreteReleasePattern.test(text)) return false;
  if (category === "Open source" && !/open[ -]?source|github|repo/i.test(text)) return false;
  if (category === "Product demos" && (!builderDemoPattern.test(text) || (!tweet.videos.length && !/\bdemo|prototype\b/i.test(text)))) return false;
  if (category === "New founders" && (!founderCommitmentPattern.test(text) || /\bstartup idea\b/i.test(text))) return false;
  return true;
}

function postScore(tweet: Tweet, category: FeedCategory, publishedAt: number) {
  const likes = tweet.likes ?? 0;
  const reposts = tweet.retweets ?? 0;
  const replies = tweet.replies ?? 0;
  const views = tweet.views ?? 0;
  const ageHours = Math.max(0, (Date.now() - publishedAt) / 3_600_000);
  const engagement = likes + reposts * 2.5 + replies * 1.25 + Math.min(80, views / 500);
  const recency = Math.max(0, 96 - ageHours) / 8;
  const categoryBoost = category === "Open source" ? 8 : category === "Product demos" ? 4 : 0;
  return Math.round((engagement + recency + categoryBoost) * 100) / 100;
}

function cleanExternalUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    const hostname = url.hostname.toLowerCase();
    if (hostname === "t.co" || hostname === "x.com" || hostname.endsWith(".x.com") || hostname === "twitter.com" || hostname.endsWith(".twitter.com") || hostname === "twimg.com" || hostname.endsWith(".twimg.com")) return null;
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:utm_|ref$|ref_|source$|s$)/i.test(key)) url.searchParams.delete(key);
    }
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function externalUrls(tweet: Tweet) {
  const urls = new Set<string>();
  for (const value of tweet.urls ?? []) {
    const cleaned = cleanExternalUrl(value);
    if (cleaned) urls.add(cleaned);
  }
  return [...urls].slice(0, 8);
}

export async function resolvePostExternalUrls(text: string, existing: string[] = []) {
  const urls = new Set(existing.map(cleanExternalUrl).filter((value): value is string => Boolean(value)));
  const shortUrls = [...new Set(text.match(/https:\/\/t\.co\/[a-z0-9]+/gi) ?? [])].slice(0, 8);
  const resolved = await Promise.all(shortUrls.map(async (shortUrl) => {
    try {
      // Never follow an untrusted redirect server-side. t.co supplies the final
      // public destination in its Location header, which is enough to enrich it.
      const response = await fetch(shortUrl, { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(10_000) });
      const location = response.headers.get("location");
      return location ? cleanExternalUrl(new URL(location, shortUrl).href) : null;
    } catch {
      return null;
    }
  }));
  for (const url of resolved) if (url) urls.add(url);
  return [...urls].slice(0, 8);
}

export function tweetToFeedPost(tweet: Tweet, category: FeedCategory): FeedPost | null {
  if (!isUsefulFeedPost(tweet, category) || !tweet.id || !tweet.username || !tweet.text) return null;
  // A quote can be a strong discovery signal, but the underlying maker's post
  // is the canonical feed item. This avoids giant nested embeds and naturally
  // deduplicates multiple people commenting on the same launch.
  const quoted = tweet.quotedStatus;
  const isFirstParty = firstPartyPattern.test(tweet.text) && builderActionPattern.test(tweet.text);
  const source = quoted?.id && quoted.username && quoted.text && !isFirstParty ? quoted : tweet;
  if (isCryptoPromotionText(source.text ?? "")) return null;
  const parsedTime = source.timeParsed?.getTime();
  const publishedAt = parsedTime && Number.isFinite(parsedTime) ? parsedTime : Date.now();
  return {
    id: source.id!,
    category,
    url: source.permanentUrl ?? `https://x.com/${source.username}/status/${source.id}`,
    username: source.username!,
    displayName: source.name ?? null,
    text: source.text!,
    publishedAt,
    likes: source.likes ?? 0,
    reposts: source.retweets ?? 0,
    replies: source.replies ?? 0,
    views: source.views ?? 0,
    mediaUrl: source.photos?.[0]?.url ?? source.videos?.[0]?.preview ?? null,
    externalUrls: externalUrls(source),
    score: Math.max(postScore(tweet, category, publishedAt), postScore(source, category, publishedAt)),
    fetchedAt: Date.now(),
  };
}

export async function scanXFeed(day = isoDay(new Date())) {
  try {
    const { SearchMode } = await import("@the-convocation/twitter-scraper");
    const scraper = await getScraper();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error(`Invalid X scan day: ${day}`);
    const startDate = new Date(`${day}T00:00:00.000Z`);
    if (!Number.isFinite(startDate.getTime()) || startDate.toISOString().slice(0, 10) !== day) throw new Error(`Invalid X scan day: ${day}`);
    const endDate = new Date(startDate.getTime() + 86_400_000);
    const posts = new Map<string, FeedPost>();
    const supersededIds = new Set<string>();
    const candidates = new Map<string, { tweet: Tweet; category: FeedCategory }>();

    for (let searchIndex = 0; searchIndex < discoverySearches.length; searchIndex += 1) {
      const search = discoverySearches[searchIndex];
      const remainingCapacity = env.xDiscoveryCandidateLimit - candidates.size;
      if (remainingCapacity <= 0) break;
      const configuredBudget = (search.topBudget ?? 0) + (search.latestBudget ?? 0);
      const searchBudget = Math.min(remainingCapacity, configuredBudget || Math.max(1, Math.ceil(remainingCapacity / (discoverySearches.length - searchIndex))));
      let addedForSearch = 0;
      const query = buildXSearchQuery(search.query, startDate, endDate);
      const modes = [SearchMode.Top, SearchMode.Latest];
      for (let modeIndex = 0; modeIndex < modes.length; modeIndex += 1) {
        const mode = modes[modeIndex];
        const configuredModeBudget = modeIndex === 0 ? search.topBudget : search.latestBudget;
        const modeBudget = Math.max(1, Math.min(
          searchBudget - addedForSearch,
          configuredModeBudget ?? Math.ceil((searchBudget - addedForSearch) / (modes.length - modeIndex)),
        ));
        let addedForMode = 0;
        const fetchLimit = Math.max(env.xMaxPostsPerQuery, Math.min(50, search.fetchLimit ?? 0));
        for await (const tweet of scraper.searchTweets(query, fetchLimit, mode)) {
          if (!tweet.id || candidates.has(tweet.id) || !isUsefulFeedPost(tweet, search.category)) continue;
          candidates.set(tweet.id, { tweet, category: search.category });
          addedForSearch += 1;
          addedForMode += 1;
          if (candidates.size >= env.xDiscoveryCandidateLimit || addedForSearch >= searchBudget || addedForMode >= modeBudget) break;
        }
        if (candidates.size >= env.xDiscoveryCandidateLimit) break;
      }
    }

    // Search results already contain the tweet, author, engagement, media,
    // links, and quoted-status payload needed by tweetToFeedPost. Hydrating
    // every candidate through TweetDetail would turn a 600-post discovery
    // scan into 600 extra X requests and exhaust the session's rate limit.
    for (const candidate of candidates.values()) {
      const post = tweetToFeedPost(candidate.tweet, candidate.category);
      if (!post) continue;
      // X search occasionally returns recent posts outside explicit since/until
      // operators. Enforce the UTC window locally before persisting anything.
      if (!isWithinScanWindow(post.publishedAt, startDate, endDate)) continue;
      if (candidate.tweet.id && candidate.tweet.id !== post.id) supersededIds.add(candidate.tweet.id);
      const existing = posts.get(post.id);
      if (!existing || post.score > existing.score) posts.set(post.id, post);
    }

    const sortedPosts = [...posts.values()].sort((a, b) => b.score - a.score);
    const enrichedPosts: FeedPost[] = [];
    for (let index = 0; index < sortedPosts.length; index += 8) {
      enrichedPosts.push(...await Promise.all(sortedPosts.slice(index, index + 8).map(async (post) => ({
        ...post,
        externalUrls: await resolvePostExternalUrls(post.text, post.externalUrls),
      }))));
    }

    return {
      posts: enrichedPosts,
      supersededIds: [...supersededIds],
      candidateCount: candidates.size,
      day,
    };
  } catch (error) {
    throw error instanceof XSessionError ? error : new XSessionError("feed scan", error);
  }
}
