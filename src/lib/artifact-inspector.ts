import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import type { ArtifactInspection, ArtifactTargetEvidence, FeedPost } from "@/db";
import {
  ARTIFACT_INSPECTION_VERSION,
  feedPostContentHash,
  getCachedArtifactInspection,
  saveArtifactInspections,
} from "@/db";
import { env } from "@/lib/env";
import { isCryptoPromotionText } from "@/lib/signal-filters";

const maxBodyBytes = 512_000;
const parkedPattern = /\b(?:domain (?:name )?is (?:for sale|parked)|buy this domain|this domain may be for sale|parking-lander|sedoparking|lander_system|afternic|hugedomains|bodis|dan\.com\/buy-domain|domainmarket\.com)\b/i;
const parkedSourcePattern = /(?:parking-lander|sedoparking|lander_system|afternic\.com|hugedomains\.com|domainmarket\.com)/i;
const unavailablePattern = /\b(?:site (?:is )?not found|page not found|website unavailable|this site can'?t be reached|deployment not found|project not found|there isn'?t a github pages site here|account suspended)\b/i;
const tokenSurfacePattern = /\b(?:bonding curve|buy(?:s|ing)?[- ](?:n|and)[- ]burn|token (?:sale|price|holders?)|connect wallet.{0,80}(?:buy|swap)|market cap|liquidity pool|contract address)\b/i;
const blockedHostPattern = /(?:^|\.)(?:localhost|local|internal|home|lan)$/i;

function isPrivateAddress(address: string) {
  if (address === "::1" || address === "::" || address.startsWith("fe80:") || address.startsWith("fc") || address.startsWith("fd")) return true;
  if (address.startsWith("::ffff:")) return isPrivateAddress(address.slice(7));
  if (isIP(address) !== 4) return false;
  const [a, b] = address.split(".").map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
}

export async function assertPublicHttpUrl(value: string) {
  const url = new URL(value);
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || blockedHostPattern.test(url.hostname)) {
    throw new Error("Blocked non-public URL");
  }
  if (isIP(url.hostname)) {
    if (isPrivateAddress(url.hostname)) throw new Error("Blocked private network URL");
  } else {
    const addresses = await lookup(url.hostname, { all: true, verbatim: true });
    if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) throw new Error("Blocked private network destination");
  }
  return url;
}

async function readLimitedText(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < maxBodyBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    const remaining = maxBodyBytes - size;
    chunks.push(value.length > remaining ? value.slice(0, remaining) : value);
    size += Math.min(value.length, remaining);
    if (value.length > remaining) await reader.cancel();
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

function decodeHtml(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)));
}

function metaContent(html: string, names: string[]) {
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const first = new RegExp(`<meta[^>]+(?:name|property)=["']${escaped}["'][^>]+content=["']([^"']*)["'][^>]*>`, "i").exec(html)?.[1];
    const reversed = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:name|property)=["']${escaped}["'][^>]*>`, "i").exec(html)?.[1];
    if (first || reversed) return decodeHtml(first ?? reversed ?? "").replace(/\s+/g, " ").trim().slice(0, 500);
  }
  return null;
}

export function extractPageEvidence(html: string) {
  const title = decodeHtml(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "").replace(/\s+/g, " ").trim().slice(0, 300) || null;
  const description = metaContent(html, ["description", "og:description", "twitter:description"]);
  const pageText = decodeHtml(html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(?:script|style|noscript|svg|template)[^>]*>[\s\S]*?<\/(?:script|style|noscript|svg|template)>/gi, " ")
    .replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 8_000);
  const signalText = `${title ?? ""} ${description ?? ""} ${pageText}`;
  return {
    title,
    description,
    pageText,
    parked: parkedSourcePattern.test(html) || parkedPattern.test(signalText),
    unavailable: unavailablePattern.test(signalText),
    cryptoPromotion: isCryptoPromotionText(signalText) || tokenSurfacePattern.test(signalText),
  };
}

async function fetchPublicPage(value: string) {
  let current = (await assertPublicHttpUrl(value)).href;
  for (let redirects = 0; redirects <= 4; redirects += 1) {
    const response = await fetch(current, {
      redirect: "manual",
      headers: { "User-Agent": "ScoutArtifactInspector/1.0 (+local product discovery)" },
      signal: AbortSignal.timeout(12_000),
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return { response, finalUrl: current, body: "" };
      current = (await assertPublicHttpUrl(new URL(location, current).href)).href;
      continue;
    }
    const contentType = response.headers.get("content-type") ?? "";
    const body = /(?:text|html|json|xml|javascript)/i.test(contentType) ? await readLimitedText(response) : "";
    return { response, finalUrl: current, body };
  }
  throw new Error("Too many redirects");
}

function githubRepoFromUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.hostname.toLowerCase() !== "github.com") return null;
    const [owner, repo] = url.pathname.split("/").filter(Boolean);
    if (!owner || !repo || ["features", "topics", "marketplace", "orgs"].includes(owner.toLowerCase())) return null;
    return `${owner}/${repo.replace(/\.git$/i, "")}`;
  } catch {
    return null;
  }
}

async function githubEvidence(value: string): Promise<ArtifactTargetEvidence["github"]> {
  const repository = githubRepoFromUrl(value);
  if (!repository) return null;
  try {
    const response = await fetch(`https://api.github.com/repos/${repository}`, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "ScoutArtifactInspector/1.0" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;
    const data = await response.json() as Record<string, unknown>;
    return {
      fullName: String(data.full_name ?? repository),
      description: typeof data.description === "string" ? data.description : null,
      createdAt: String(data.created_at ?? ""),
      updatedAt: String(data.updated_at ?? ""),
      stars: Number(data.stargazers_count ?? 0),
      forks: Number(data.forks_count ?? 0),
      archived: Boolean(data.archived),
    };
  } catch {
    return null;
  }
}

export async function inspectTargetUrl(requestedUrl: string): Promise<ArtifactTargetEvidence> {
  try {
    const [{ response, finalUrl, body }, github] = await Promise.all([
      fetchPublicPage(requestedUrl),
      githubEvidence(requestedUrl),
    ]);
    const contentType = response.headers.get("content-type");
    const extracted = /html/i.test(contentType ?? "") || /<html|<title|<meta/i.test(body)
      ? extractPageEvidence(body)
      : { title: null, description: null, pageText: body.replace(/\s+/g, " ").trim().slice(0, 8_000), parked: false, unavailable: false, cryptoPromotion: false };
    const unavailable = !response.ok || extracted.unavailable;
    return {
      requestedUrl,
      finalUrl,
      status: response.status,
      contentType,
      ...extracted,
      unavailable,
      github,
      error: null,
    };
  } catch (error) {
    return {
      requestedUrl,
      finalUrl: null,
      status: null,
      contentType: null,
      title: null,
      description: null,
      pageText: "",
      parked: false,
      unavailable: true,
      cryptoPromotion: false,
      github: null,
      error: error instanceof Error ? error.message.slice(0, 300) : "Artifact inspection failed",
    };
  }
}

function targetPriority(value: string) {
  try {
    const host = new URL(value).hostname.toLowerCase();
    if (host === "github.com") return 0;
    if (/appstore|apps\.apple|play\.google/.test(host)) return 1;
    if (/telegram|t\.me|launchpad|medium|substack/.test(host)) return 4;
    return 2;
  } catch {
    return 5;
  }
}

export async function inspectFeedArtifacts(posts: FeedPost[]) {
  const evidence = new Map<string, ArtifactInspection>();
  let cached = 0;
  let inspected = 0;
  for (let index = 0; index < posts.length; index += 6) {
    await Promise.all(posts.slice(index, index + 6).map(async (post) => {
      const existing = getCachedArtifactInspection(post);
      if (existing) {
        evidence.set(post.id, existing);
        cached += 1;
        return;
      }
      const urls = [...post.externalUrls]
        .sort((a, b) => targetPriority(a) - targetPriority(b))
        .slice(0, env.artifactUrlsPerPost);
      const inspection: ArtifactInspection = {
        postId: post.id,
        contentHash: feedPostContentHash(post),
        inspectionVersion: ARTIFACT_INSPECTION_VERSION,
        targets: await Promise.all(urls.map(inspectTargetUrl)),
        webEvidence: null,
        screenshotPath: null,
        inspectedAt: Date.now(),
      };
      saveArtifactInspections([inspection]);
      evidence.set(post.id, inspection);
      inspected += 1;
    }));
  }
  return { evidence, inspected, cached };
}

export function artifactPromptEvidence(inspection: ArtifactInspection | null | undefined) {
  if (!inspection) return { targets: [], webEvidence: null };
  return {
    targets: inspection.targets.map((target) => ({
      url: target.finalUrl ?? target.requestedUrl,
      status: target.status,
      title: target.title,
      description: target.description,
      pageText: target.pageText.slice(0, 2_500),
      parked: target.parked,
      unavailable: target.unavailable,
      cryptoPromotion: target.cryptoPromotion,
      github: target.github,
      error: target.error,
    })),
    webEvidence: inspection.webEvidence,
  };
}

export function hasUsableArtifact(inspection: ArtifactInspection | null | undefined) {
  return Boolean(inspection?.targets.some((target) => !target.parked && !target.unavailable && !target.cryptoPromotion && (target.title || target.description || target.pageText || target.github)));
}

export function hasHardArtifactRejection(inspection: ArtifactInspection | null | undefined) {
  const targets = inspection?.targets ?? [];
  return targets.length > 0 && targets.every((target) => target.parked || target.unavailable || target.cryptoPromotion);
}
