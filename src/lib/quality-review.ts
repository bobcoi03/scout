import fs from "node:fs/promises";
import path from "node:path";

import type { ArtifactInspection, FeedPost, PostAnalysis, WebEvidence } from "@/db";
import { getCachedArtifactInspection, getCachedPostAnalysis, saveArtifactInspections, savePostAnalyses } from "@/db";
import { analyzeFeedPosts, type AnalystRun } from "@/lib/analyst";
import {
  artifactPromptEvidence,
  assertPublicHttpUrl,
  hasHardArtifactRejection,
  hasUsableArtifact,
  inspectFeedArtifacts,
  inspectTargetUrl,
} from "@/lib/artifact-inspector";
import { analystConfigured, env } from "@/lib/env";
import { isCryptoPromotionText } from "@/lib/signal-filters";

type ResponsesResult = {
  output?: Array<{
    type?: string;
    content?: Array<{
      type?: string;
      text?: string;
      annotations?: Array<{ type?: string; url?: string; title?: string }>;
    }>;
  }>;
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { message?: string };
};

type VisualVerdict = {
  keep: boolean;
  qualityScore: number;
  productDepth: number;
  visualCraft: number;
  novelty: number;
  credibility: number;
  freshness: number;
  notability: number;
  investorRelevance: number;
  seoProbability: number;
  confidence: number;
  projectKey: string | null;
  projectUrl: string | null;
  description: string | null;
  rejectionReason: string | null;
  evidence: string[];
};

const webEvidenceSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    officialUrl: { type: ["string", "null"] },
    launchDate: { type: ["string", "null"] },
    established: { type: "boolean" },
    summary: { type: "string" },
  },
  required: ["officialUrl", "launchDate", "established", "summary"],
} as const;

const visualSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    keep: { type: "boolean" },
    qualityScore: { type: "integer", minimum: 0, maximum: 100 },
    productDepth: { type: "integer", minimum: 0, maximum: 100 },
    visualCraft: { type: "integer", minimum: 0, maximum: 100 },
    novelty: { type: "integer", minimum: 0, maximum: 100 },
    credibility: { type: "integer", minimum: 0, maximum: 100 },
    freshness: { type: "integer", minimum: 0, maximum: 100 },
    notability: { type: "integer", minimum: 0, maximum: 100 },
    investorRelevance: { type: "integer", minimum: 0, maximum: 100 },
    seoProbability: { type: "integer", minimum: 0, maximum: 100 },
    confidence: { type: "integer", minimum: 0, maximum: 100 },
    projectKey: { type: ["string", "null"] },
    projectUrl: { type: ["string", "null"] },
    description: { type: ["string", "null"] },
    rejectionReason: { type: ["string", "null"] },
    evidence: { type: "array", maxItems: 3, items: { type: "string" } },
  },
  required: [
    "keep", "qualityScore", "productDepth", "visualCraft", "novelty", "credibility",
    "freshness", "notability", "investorRelevance", "seoProbability", "confidence",
    "projectKey", "projectUrl", "description", "rejectionReason", "evidence",
  ],
} as const;

const rerankSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    rankings: {
      type: "array",
      maxItems: 50,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          postId: { type: "string" },
          score: { type: "integer", minimum: 0, maximum: 100 },
          reason: { type: "string" },
        },
        required: ["postId", "score", "reason"],
      },
    },
  },
  required: ["rankings"],
} as const;

function clamp(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, Math.round(number))) : 0;
}

function outputText(result: ResponsesResult) {
  for (const item of result.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === "output_text" && content.text) return content.text;
    }
  }
  return null;
}

function responseSources(result: ResponsesResult) {
  const sources = new Map<string, { title: string; url: string }>();
  for (const item of result.output ?? []) {
    for (const content of item.content ?? []) {
      for (const annotation of content.annotations ?? []) {
        if (annotation.type === "url_citation" && annotation.url) {
          sources.set(annotation.url, { title: annotation.title ?? annotation.url, url: annotation.url });
        }
      }
    }
  }
  return [...sources.values()].slice(0, 8);
}

function modelCostMicros(model: string, inputTokens: number, outputTokens: number) {
  const prices = model.includes("nano") ? { input: 0.2, output: 1.25 }
    : model.includes("mini") ? { input: 0.75, output: 4.5 }
      : { input: 2.5, output: 15 };
  return Math.round((inputTokens * prices.input + outputTokens * prices.output) / 1_000_000 * 1_000_000);
}

async function responseRequest(body: Record<string, unknown>, timeoutMs = 90_000) {
  let lastError = "Unknown OpenAI error";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.oaiApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const result = await response.json() as ResponsesResult;
    if (response.ok) return result;
    lastError = result.error?.message ?? `OpenAI request failed with ${response.status}`;
    if (response.status !== 429 && response.status < 500) break;
    await new Promise((resolve) => setTimeout(resolve, 1_500));
  }
  throw new Error(lastError);
}

function analysisMap(posts: FeedPost[]) {
  return new Map(posts.map((post) => [post.id, getCachedPostAnalysis(post)]).filter((entry): entry is [string, PostAnalysis] => Boolean(entry[1])));
}

function finalistScore(post: FeedPost, analysis: PostAnalysis | undefined) {
  const engagementSignal = Math.min(45, Math.log10(Math.max(1, post.score + 1)) * 22);
  return (analysis?.keep ? 160 : 0) + (analysis?.analystScore ?? 0) + engagementSignal;
}

function selectFinalists(posts: FeedPost[], analyses: Map<string, PostAnalysis>) {
  return [...posts]
    .sort((a, b) => finalistScore(b, analyses.get(b.id)) - finalistScore(a, analyses.get(a.id)))
    .slice(0, env.visualReviewLimit);
}

function needsWebEvidence(inspection: ArtifactInspection | undefined) {
  if (inspection?.webEvidence) return false;
  if (!hasUsableArtifact(inspection)) return true;
  return Boolean(inspection?.targets.some((target) => {
    const created = target.github?.createdAt ? Date.parse(target.github.createdAt) : NaN;
    const ageDays = Number.isFinite(created) ? (Date.now() - created) / 86_400_000 : 0;
    return target.github && (ageDays > 180 || target.github.stars >= 1_000);
  }));
}

async function searchForArtifact(post: FeedPost, inspection: ArtifactInspection) {
  const result = await responseRequest({
    model: env.visualModel,
    tools: [{ type: "web_search", search_context_size: "low" }],
    max_tool_calls: 1,
    instructions: "Find factual evidence about the exact product launch in this X post. Prefer the official product site, official repository, and first-party launch announcement. Do not confuse similarly named products. Return null officialUrl when uncertain.",
    input: JSON.stringify({
      date: new Date(post.publishedAt).toISOString().slice(0, 10),
      author: `@${post.username}`,
      text: post.text,
      knownArtifacts: artifactPromptEvidence(inspection),
    }),
    text: { format: { type: "json_schema", name: "scout_web_evidence", strict: true, schema: webEvidenceSchema } },
  }, 75_000);
  const text = outputText(result);
  if (!text) throw new Error("Web search returned no evidence");
  const parsed = JSON.parse(text) as Omit<WebEvidence, "sources">;
  const evidence: WebEvidence = {
    officialUrl: typeof parsed.officialUrl === "string" && /^https?:\/\//.test(parsed.officialUrl) ? parsed.officialUrl : null,
    launchDate: typeof parsed.launchDate === "string" ? parsed.launchDate.slice(0, 40) : null,
    established: Boolean(parsed.established),
    summary: typeof parsed.summary === "string" ? parsed.summary.replace(/\s+/g, " ").slice(0, 1_000) : "",
    sources: responseSources(result),
  };
  const updated: ArtifactInspection = { ...inspection, webEvidence: evidence, inspectedAt: Date.now() };
  if (evidence.officialUrl) {
    try {
      await assertPublicHttpUrl(evidence.officialUrl);
      const normalized = new URL(evidence.officialUrl).href;
      if (!updated.targets.some((target) => (target.finalUrl ?? target.requestedUrl) === normalized)) {
        updated.targets = [await inspectTargetUrl(normalized), ...updated.targets].slice(0, env.artifactUrlsPerPost);
      }
    } catch {
      updated.webEvidence = { ...evidence, officialUrl: null };
    }
  }
  saveArtifactInspections([updated]);
  return updated;
}

async function addSelectiveWebEvidence(finalists: FeedPost[], inspections: Map<string, ArtifactInspection>) {
  const selected = finalists.filter((post) => needsWebEvidence(inspections.get(post.id))).slice(0, env.webSearchLimit);
  let searched = 0;
  for (const post of selected) {
    const inspection = inspections.get(post.id);
    if (!inspection) continue;
    try {
      const updated = await searchForArtifact(post, inspection);
      inspections.set(post.id, updated);
      searched += 1;
    } catch (error) {
      console.warn(`Web evidence skipped for ${post.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return searched;
}

function primaryArtifact(inspection: ArtifactInspection | undefined) {
  return inspection?.targets.find((target) => !target.parked && !target.unavailable && !target.cryptoPromotion && target.finalUrl)
    ?? inspection?.targets.find((target) => !target.parked && !target.unavailable && !target.cryptoPromotion);
}

function isEstablishedArtifact(inspection: ArtifactInspection | undefined) {
  if (inspection?.webEvidence?.established) return true;
  return Boolean(inspection?.targets.some((target) => {
    const created = target.github?.createdAt ? Date.parse(target.github.createdAt) : NaN;
    const ageDays = Number.isFinite(created) ? (Date.now() - created) / 86_400_000 : 0;
    return target.github && ageDays > 180 && target.github.stars >= 1_000;
  }));
}

function clearsEditorialBar(input: { quality: number; productDepth: number; credibility: number; freshness: number; notability: number }, inspection: ArtifactInspection | undefined) {
  const normalLaunch = input.quality >= 74;
  const importantLaunch = input.quality >= 70 && input.notability >= 82;
  const establishedLaunch = !isEstablishedArtifact(inspection) || (input.freshness >= 80 && input.notability >= 80);
  return (normalLaunch || importantLaunch)
    && input.productDepth >= 65
    && input.credibility >= 65
    && input.freshness >= 55
    && establishedLaunch;
}

async function captureFinalistScreenshots(finalists: FeedPost[], inspections: Map<string, ArtifactInspection>) {
  const screenshotByPost = new Map<string, string>();
  if (!finalists.some((post) => primaryArtifact(inspections.get(post.id)))) return screenshotByPost;
  try {
    const { chromium } = await import("@playwright/test");
    const browser = await chromium.launch({ headless: true });
    try {
      for (const post of finalists) {
        const inspection = inspections.get(post.id);
        if (inspection?.screenshotPath) {
          try {
            await fs.access(inspection.screenshotPath);
            screenshotByPost.set(post.id, inspection.screenshotPath);
            continue;
          } catch {
            // Re-capture a screenshot whose cache entry points to a missing file.
          }
        }
        const target = primaryArtifact(inspection);
        const targetUrl = target?.finalUrl ?? target?.requestedUrl;
        if (!inspection || !targetUrl) continue;
        const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: "block" });
        const allowedHosts = new Map<string, Promise<boolean>>();
        await context.route("**/*", async (route) => {
          const requestUrl = route.request().url();
          // Product pages occasionally leave web-font promises pending forever,
          // and Playwright waits for document.fonts before taking a screenshot.
          // System-font fallbacks preserve the layout signal without a 30s stall.
          if (route.request().resourceType() === "font") return route.abort("blockedbyclient");
          if (/^(?:data|blob):/.test(requestUrl)) return route.continue();
          try {
            const host = new URL(requestUrl).hostname;
            const allowed = allowedHosts.get(host) ?? assertPublicHttpUrl(requestUrl).then(() => true).catch(() => false);
            allowedHosts.set(host, allowed);
            return await allowed ? route.continue() : route.abort("blockedbyclient");
          } catch {
            return route.abort("blockedbyclient");
          }
        });
        const page = await context.newPage();
        try {
          await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 15_000 });
          await page.waitForTimeout(1_000);
          const day = new Date(post.publishedAt).toISOString().slice(0, 10);
          const directory = path.resolve(process.cwd(), "data", "screenshots", day);
          await fs.mkdir(directory, { recursive: true });
          const screenshotPath = path.join(directory, `${post.id}.jpg`);
          await page.screenshot({ path: screenshotPath, type: "jpeg", quality: 72, fullPage: false });
          screenshotByPost.set(post.id, screenshotPath);
          const updated = { ...inspection, screenshotPath, inspectedAt: Date.now() };
          inspections.set(post.id, updated);
          saveArtifactInspections([updated]);
        } catch (error) {
          console.warn(`Screenshot skipped for ${post.id}: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
          await context.close();
        }
      }
    } finally {
      await browser.close();
    }
  } catch (error) {
    console.warn(`Visual capture unavailable; continuing with page evidence: ${error instanceof Error ? error.message : String(error)}`);
  }
  return screenshotByPost;
}

function comparableUrl(value: string) {
  try {
    const url = new URL(value);
    url.hash = "";
    return `${url.hostname.toLowerCase()}${url.pathname.replace(/\/$/, "")}${url.search}`;
  } catch {
    return null;
  }
}

function allowedProjectUrl(value: unknown, post: FeedPost, inspection: ArtifactInspection | undefined, fallback: string | null) {
  if (typeof value !== "string") return fallback;
  const wanted = comparableUrl(value);
  const allowed = [...post.externalUrls, ...(inspection?.targets.flatMap((target) => [target.requestedUrl, target.finalUrl].filter((url): url is string => Boolean(url))) ?? [])];
  return allowed.find((url) => comparableUrl(url) === wanted) ?? fallback;
}

async function visualReview(post: FeedPost, prior: PostAnalysis, inspection: ArtifactInspection | undefined, screenshotPath: string | undefined) {
  const inputText = JSON.stringify({
    post: {
      author: `@${post.username}`,
      displayName: post.displayName,
      text: post.text,
      publishedAt: new Date(post.publishedAt).toISOString(),
      hasTweetMedia: Boolean(post.mediaUrl),
    },
    preliminaryVerdict: prior,
    artifactEvidence: artifactPromptEvidence(inspection),
  });
  const content: Array<Record<string, unknown>> = [{ type: "input_text", text: inputText }];
  if (screenshotPath) {
    const image = await fs.readFile(screenshotPath);
    content.push({ type: "input_image", image_url: `data:image/jpeg;base64,${image.toString("base64")}`, detail: "low" });
  }
  const result = await responseRequest({
    model: env.visualModel,
    instructions: `You are the final quality editor for a daily feed of genuinely important, technically interesting, beautifully executed product launches.

Judge the actual artifact, not the confidence or engagement of the tweet. The screenshot is supporting evidence, never proof by itself. Reward product depth, working interaction, technical specificity, coherent design, novelty, credibility, launch freshness, and whether a discerning builder or investor would regret missing it.

Reject parked/dead/unrelated links, domain-sale pages, token-sale or bonding-curve surfaces, scammy crypto promotion, generic AI wrappers with no demonstrated product depth, thin hackathon prototypes, landing-page-only concepts, recycled old projects presented as new, SEO/tutorial bait, and vague healthcare/finance/crypto claims without a verifiable product. A mature company can qualify only for a genuinely important new launch; do not reward it merely for being famous. Small independent launches can outrank large companies when they are unusually crafted or technically original.

Set keep=true only if it clears a high-quality daily editorial bar. qualityScore is holistic. A score of 80+ means a standout launch, 65-79 is solid enough to publish, and below 65 should normally be rejected. projectUrl must be one of the supplied URLs. Give concrete evidence grounded in the page, screenshot, repository metadata, or sourced web evidence.`,
    input: [{ role: "user", content }],
    text: { format: { type: "json_schema", name: "scout_visual_review", strict: true, schema: visualSchema } },
  }, 90_000);
  const text = outputText(result);
  if (!text) throw new Error("Visual review returned no verdict");
  const verdict = JSON.parse(text) as VisualVerdict;
  const quality = clamp(verdict.qualityScore);
  const productDepth = clamp(verdict.productDepth);
  const credibility = clamp(verdict.credibility);
  const freshness = clamp(verdict.freshness);
  const notability = clamp(verdict.notability);
  const hardRejected = hasHardArtifactRejection(inspection) || isCryptoPromotionText(post.text) || Boolean(inspection?.targets.some((target) => target.cryptoPromotion));
  const artifactVerified = hasUsableArtifact(inspection);
  const exceptionalMediaOnly = !inspection?.targets.length && Boolean(post.mediaUrl) && quality >= 82 && credibility >= 70;
  const keep = Boolean(verdict.keep)
    && clearsEditorialBar({ quality, productDepth, credibility, freshness, notability }, inspection)
    && (artifactVerified || exceptionalMediaOnly)
    && !hardRejected;
  const inputTokens = result.usage?.input_tokens ?? 0;
  const outputTokens = result.usage?.output_tokens ?? 0;
  const fallbackUrl = primaryArtifact(inspection)?.finalUrl ?? primaryArtifact(inspection)?.requestedUrl ?? prior.projectUrl;
  const dimensionEvidence = `Quality ${quality}; depth ${productDepth}; craft ${clamp(verdict.visualCraft)}; novelty ${clamp(verdict.novelty)}; credibility ${credibility}; freshness ${freshness}; notability ${notability}.`;
  return {
    ...prior,
    model: `${prior.model}+${env.visualModel}`,
    keep,
    analystScore: quality,
    investorRelevance: clamp(verdict.investorRelevance),
    seoProbability: clamp(verdict.seoProbability),
    confidence: clamp(verdict.confidence),
    projectKey: typeof verdict.projectKey === "string" && verdict.projectKey.trim() ? verdict.projectKey.trim().toLowerCase() : prior.projectKey,
    projectUrl: keep ? allowedProjectUrl(verdict.projectUrl, post, inspection, fallbackUrl) : null,
    description: keep && typeof verdict.description === "string" ? verdict.description.replace(/\s+/g, " ").trim().slice(0, 240) : null,
    rejectionReason: keep ? null : (hardRejected
      ? "The linked artifact failed verification or exposed token-promotion/scam mechanics."
      : typeof verdict.rejectionReason === "string" ? verdict.rejectionReason.slice(0, 500) : "The product did not clear Scout's final quality bar."),
    evidence: [dimensionEvidence, ...(Array.isArray(verdict.evidence) ? verdict.evidence.filter((item): item is string => typeof item === "string") : [])].slice(0, 3),
    inputTokens: prior.inputTokens + inputTokens,
    outputTokens: prior.outputTokens + outputTokens,
    costMicros: prior.costMicros + modelCostMicros(env.visualModel, inputTokens, outputTokens),
    analyzedAt: Date.now(),
  } satisfies PostAnalysis;
}

async function reviewFinalists(finalists: FeedPost[], inspections: Map<string, ArtifactInspection>, screenshots: Map<string, string>) {
  const reviewed = new Set<string>();
  for (let index = 0; index < finalists.length; index += 2) {
    await Promise.all(finalists.slice(index, index + 2).map(async (post) => {
      const prior = getCachedPostAnalysis(post);
      if (!prior) return;
      try {
        const final = await visualReview(post, prior, inspections.get(post.id), screenshots.get(post.id));
        savePostAnalyses([final]);
        reviewed.add(post.id);
      } catch (error) {
        console.warn(`Final review skipped for ${post.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }));
  }
  return reviewed;
}

function parsedQualityDimensions(analysis: PostAnalysis) {
  const text = analysis.evidence.join(" ");
  const match = /Quality (\d+); depth (\d+); craft \d+; novelty \d+; credibility (\d+); freshness (\d+); notability (\d+)/i.exec(text);
  return match ? { quality: Number(match[1]), productDepth: Number(match[2]), credibility: Number(match[3]), freshness: Number(match[4]), notability: Number(match[5]) } : null;
}

function rejectPostsWithoutFinalReview(posts: FeedPost[], reviewed: Set<string>, inspections: Map<string, ArtifactInspection>) {
  const demoted: PostAnalysis[] = [];
  for (const post of posts) {
    const analysis = getCachedPostAnalysis(post);
    if (!analysis?.keep) continue;
    const dimensions = parsedQualityDimensions(analysis);
    const clearsQuality = dimensions ? clearsEditorialBar(dimensions, inspections.get(post.id)) : false;
    if (reviewed.has(post.id) && clearsQuality) continue;
    demoted.push({
      ...analysis,
      keep: false,
      projectUrl: null,
      description: null,
      rejectionReason: reviewed.has(post.id)
        ? "The visually reviewed artifact did not clear Scout's final product-depth, credibility, freshness, and quality bar."
        : "The item did not reach or complete Scout's bounded final quality review.",
      analyzedAt: Date.now(),
    });
  }
  if (demoted.length) savePostAnalyses(demoted);
  return demoted.length;
}

async function rerankAccepted(posts: FeedPost[], inspections: Map<string, ArtifactInspection>) {
  const accepted = posts.map((post) => ({ post, analysis: getCachedPostAnalysis(post) }))
    .filter((item): item is { post: FeedPost; analysis: PostAnalysis } => Boolean(item.analysis?.keep));
  if (!accepted.length) return 0;
  try {
    const result = await responseRequest({
      model: env.rerankModel,
      instructions: `Calibrate one daily product-launch feed. Compare every accepted item against the others and assign a unique editorial score from 0-100. Rank what a highly technical builder or early-stage investor would most regret missing. Favor verified product depth, craft, novelty, credibility, freshness, and notability. Penalize shallow wrappers, generic hackathon work, mature-company routine updates, weak evidence, and crypto/token promotion. Do not change the set of post IDs and return each exactly once.`,
      input: JSON.stringify(accepted.map(({ post, analysis }) => ({
        postId: post.id,
        author: `@${post.username}`,
        text: post.text,
        verdict: analysis,
        artifact: artifactPromptEvidence(inspections.get(post.id)),
      }))),
      text: { format: { type: "json_schema", name: "scout_daily_ranking", strict: true, schema: rerankSchema } },
    }, 120_000);
    const text = outputText(result);
    if (!text) throw new Error("Reranker returned no rankings");
    const parsed = JSON.parse(text) as { rankings?: Array<{ postId: string; score: number; reason: string }> };
    const expected = new Set(accepted.map(({ post }) => post.id));
    const rankings = (parsed.rankings ?? []).filter((ranking) => expected.has(ranking.postId));
    if (new Set(rankings.map((ranking) => ranking.postId)).size !== expected.size) throw new Error("Reranker omitted accepted items");
    const inputShare = Math.ceil((result.usage?.input_tokens ?? 0) / accepted.length);
    const outputShare = Math.ceil((result.usage?.output_tokens ?? 0) / accepted.length);
    const costShare = Math.ceil(modelCostMicros(env.rerankModel, result.usage?.input_tokens ?? 0, result.usage?.output_tokens ?? 0) / accepted.length);
    const rankingMap = new Map(rankings.map((ranking) => [ranking.postId, ranking]));
    savePostAnalyses(accepted.map(({ analysis }) => {
      const ranking = rankingMap.get(analysis.postId)!;
      return {
        ...analysis,
        model: `${analysis.model}+${env.rerankModel}`,
        analystScore: clamp(ranking.score),
        evidence: [ranking.reason.slice(0, 300), ...analysis.evidence].slice(0, 3),
        inputTokens: analysis.inputTokens + inputShare,
        outputTokens: analysis.outputTokens + outputShare,
        costMicros: analysis.costMicros + costShare,
        analyzedAt: Date.now(),
      };
    }));
    return accepted.length;
  } catch (error) {
    console.warn(`Daily rerank skipped: ${error instanceof Error ? error.message : String(error)}`);
    return 0;
  }
}

export type QualityPipelineRun = AnalystRun & {
  artifactInspected: number;
  artifactCached: number;
  linksSearched: number;
  screenshots: number;
  visuallyReviewed: number;
  reranked: number;
};

export async function runQualityPipeline(posts: FeedPost[]): Promise<QualityPipelineRun> {
  if (!analystConfigured()) throw new Error("OAI_API_KEY is not configured");
  const limited = posts.slice(0, env.analystDailyCandidateLimit);
  const artifactRun = await inspectFeedArtifacts(limited);
  const preliminary = await analyzeFeedPosts(limited, artifactRun.evidence);
  const finalists = selectFinalists(limited, analysisMap(limited));
  const linksSearched = await addSelectiveWebEvidence(finalists, artifactRun.evidence);
  const screenshots = await captureFinalistScreenshots(finalists, artifactRun.evidence);
  const reviewedIds = await reviewFinalists(finalists, artifactRun.evidence, screenshots);
  rejectPostsWithoutFinalReview(limited, reviewedIds, artifactRun.evidence);
  const reranked = await rerankAccepted(limited, artifactRun.evidence);
  const final = [...analysisMap(limited).values()];
  return {
    ...preliminary,
    accepted: final.filter((item) => item.keep).length,
    rejected: final.filter((item) => !item.keep).length,
    inputTokens: final.reduce((sum, item) => sum + item.inputTokens, 0),
    outputTokens: final.reduce((sum, item) => sum + item.outputTokens, 0),
    costMicros: final.reduce((sum, item) => sum + item.costMicros, 0) + linksSearched * 10_000,
    artifactInspected: artifactRun.inspected,
    artifactCached: artifactRun.cached,
    linksSearched,
    screenshots: screenshots.size,
    visuallyReviewed: reviewedIds.size,
    reranked,
  };
}

export async function finalizeReviewedFeed(posts: FeedPost[]) {
  const limited = posts.slice(0, env.analystDailyCandidateLimit);
  const inspections = new Map<string, ArtifactInspection>();
  const reviewed = new Set<string>();
  for (const post of limited) {
    const inspection = getCachedArtifactInspection(post);
    if (inspection) inspections.set(post.id, inspection);
    const analysis = getCachedPostAnalysis(post);
    if (analysis?.model.includes(env.visualModel)) reviewed.add(post.id);
  }
  const demoted = rejectPostsWithoutFinalReview(limited, reviewed, inspections);
  const reranked = await rerankAccepted(limited, inspections);
  return { reviewed: reviewed.size, demoted, reranked };
}
