import fs from "node:fs/promises";

import type {
  FeedPost,
  InvestigationPacket,
  InvestigatorDecision,
  InvestigatorSourceRole,
  InvestigatorVerdict,
  PostAnalysis,
} from "@/db";
import {
  INVESTIGATOR_VERSION,
  feedPostContentHash,
  getCachedArtifactInspection,
  getCachedInvestigatorVerdict,
  getCachedPostAnalysis,
  saveInvestigatorVerdicts,
} from "@/db";
import { env } from "@/lib/env";
import {
  buildInvestigationPacket,
  captureMissingSiteScreenshots,
  hasEstablishedProjectResurface,
  hasThinClaimArtifactMismatch,
} from "@/lib/investigator-evidence";

type ResponsesResult = {
  output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { message?: string };
};

type RawInvestigatorVerdict = {
  decision: "reject" | "watch" | "shortlist";
  sourceRole: InvestigatorSourceRole;
  officialSourceUrl: string | null;
  canonicalEventKey: string;
  sourceAuthority: number;
  founderCare: number;
  productSubstance: number;
  marketPotential: number;
  differentiation: number;
  credibility: number;
  evidenceConfidence: number;
  investorRelevance: number;
  worthFiveMinutes: number;
  projectKey: string | null;
  projectUrl: string | null;
  description: string | null;
  rejectionReason: string | null;
  slopFlags: string[];
  evidence: string[];
};

const sourceRoles: InvestigatorSourceRole[] = ["official", "creator", "team_member", "credible_third_party", "commentary", "unknown"];
const miniDecisions = ["reject", "watch", "shortlist"] as const;
const finalDecisions = ["reject", "watch", "publish"] as const;

const verdictSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    decision: { type: "string", enum: miniDecisions },
    sourceRole: { type: "string", enum: sourceRoles },
    officialSourceUrl: { type: ["string", "null"] },
    canonicalEventKey: { type: "string" },
    sourceAuthority: { type: "integer", minimum: 0, maximum: 100 },
    founderCare: { type: "integer", minimum: 0, maximum: 100 },
    productSubstance: { type: "integer", minimum: 0, maximum: 100 },
    marketPotential: { type: "integer", minimum: 0, maximum: 100 },
    differentiation: { type: "integer", minimum: 0, maximum: 100 },
    credibility: { type: "integer", minimum: 0, maximum: 100 },
    evidenceConfidence: { type: "integer", minimum: 0, maximum: 100 },
    investorRelevance: { type: "integer", minimum: 0, maximum: 100 },
    worthFiveMinutes: { type: "integer", minimum: 0, maximum: 100 },
    projectKey: { type: ["string", "null"] },
    projectUrl: { type: ["string", "null"] },
    description: { type: ["string", "null"] },
    rejectionReason: { type: ["string", "null"] },
    slopFlags: { type: "array", maxItems: 8, items: { type: "string" } },
    evidence: { type: "array", maxItems: 5, items: { type: "string" } },
  },
  required: [
    "decision", "sourceRole", "officialSourceUrl", "canonicalEventKey", "sourceAuthority",
    "founderCare", "productSubstance", "marketPotential", "differentiation", "credibility",
    "evidenceConfidence", "investorRelevance", "worthFiveMinutes", "projectKey", "projectUrl",
    "description", "rejectionReason", "slopFlags", "evidence",
  ],
} as const;

const finalSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    decisions: {
      type: "array",
      minItems: 1,
      maxItems: 30,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          postId: { type: "string" },
          decision: { type: "string", enum: finalDecisions },
          rank: { type: "integer", minimum: 1, maximum: 30 },
          worthFiveMinutes: { type: "integer", minimum: 0, maximum: 100 },
          reason: { type: "string" },
        },
        required: ["postId", "decision", "rank", "worthFiveMinutes", "reason"],
      },
    },
  },
  required: ["decisions"],
} as const;

const investigatorInstructions = `You are Scout's evidence-based investment discovery analyst. Scout is an intern for seed, pre-seed, and angel investors: it should surface only products that deserve five minutes of human attention.

Judge care and potential, not polish alone. Look for a real product, credible builder connection, technical or product substance, a plausible market, differentiation, and evidence that the team cares about execution. A small or early project can qualify. Low followers or low engagement are not negatives by themselves.

Be aggressively skeptical of:
- commentary, news accounts, quote/repost accounts, and people discussing another team's launch;
- generic vibe-coded comparisons, clone demos, shallow wrappers, template landing pages, placeholder sites, and casual hackathon submissions;
- impressive marketing claims unsupported by the linked repository or working product;
- repositories containing only a landing page, generated assets, or toy scripts while the post claims substantial infrastructure;
- old products presented as new, directories, tutorials, content marketing, and products with no credible artifact.

Temporary hosting such as vercel.app is a weak negative, never an automatic rejection. Likewise, stars, follower counts, and visual polish are supporting signals rather than proof.

sourceRole describes the author of the X post. If the author is commentary or unknown, use web search when available to find the official product/founder launch. officialSourceUrl should prefer the official X launch post; otherwise use the first-party product site or repository. Do not pretend the commentator is the maker.

decision meanings:
- reject: not a product launch, clearly low-care/slop, unsupported claims, weak or mismatched artifact, or not worth investor time;
- watch: real and potentially interesting but evidence, substance, market, or source quality is not strong enough today;
- shortlist: genuinely deserves comparison against the day's best opportunities.

worthFiveMinutes is the calibrated probability-like editorial score that a discerning early-stage investor would be glad they examined this for five minutes. Use concrete packet evidence.`;

const finalInstructions = `You are the final editor of one daily Scout briefing for seed, pre-seed, and angel investors.

You may reject any candidate. Publish at most the requested maximum; fewer is better when the day is weak. Optimize precision over recall. A published item must be a real, cared-for product with credible evidence and enough product, technical, or market potential to deserve five minutes from an investor.

Reject or watch polished but shallow demos, generic comparisons, claim/artifact mismatches, low-effort landing pages, news/commentary without a verified official source, and items included mainly because their tweet was engaging. Avoid duplicate products. Return every supplied postId exactly once.`;

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

function modelCostMicros(model: string, inputTokens: number, outputTokens: number) {
  const prices = model.includes("nano") ? { input: 0.2, output: 1.25 }
    : model.includes("mini") ? { input: 0.75, output: 4.5 }
      : { input: 2.5, output: 15 };
  return Math.round(inputTokens * prices.input + outputTokens * prices.output);
}

async function responseRequest(body: Record<string, unknown>, timeoutMs = 120_000) {
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

function candidateScore(post: FeedPost, analysis: PostAnalysis | null) {
  const engagement = Math.min(35, Math.log10(Math.max(1, post.score + 1)) * 16);
  const reachedOldFinal = analysis?.model.includes("mini") ? 180 : 0;
  return reachedOldFinal + (analysis?.keep ? 120 : 0) + (analysis?.analystScore ?? 0)
    + (analysis?.investorRelevance ?? 0) * 0.35 + engagement;
}

export function selectInvestigatorCandidates(posts: FeedPost[], limit = env.investigatorReviewLimit) {
  return [...posts]
    .map((post) => ({ post, analysis: getCachedPostAnalysis(post) }))
    .filter((item): item is { post: FeedPost; analysis: PostAnalysis } => Boolean(item.analysis))
    .sort((a, b) => candidateScore(b.post, b.analysis) - candidateScore(a.post, a.analysis))
    .slice(0, limit);
}

function promptPacket(packet: InvestigationPacket) {
  return {
    ...packet,
    sites: packet.sites.map((site) => ({ ...site, screenshotPath: site.screenshotPath ? "attached" : null, textSample: site.textSample.slice(0, 3_500) })),
    repositories: packet.repositories.map((repository) => ({
      ...repository,
      representativeFiles: repository.representativeFiles.map((file) => ({ path: file.path, excerpt: file.excerpt.slice(0, 900) })),
    })),
    media: {
      ...packet.media,
      framePaths: packet.media.framePaths.length ? `${Math.min(3, packet.media.framePaths.length)} frames attached` : [],
    },
  };
}

async function imageContent(pathname: string) {
  const image = await fs.readFile(pathname);
  return { type: "input_image", image_url: `data:image/jpeg;base64,${image.toString("base64")}`, detail: "low" };
}

function needsWebSearch(packet: InvestigationPacket) {
  return packet.sourceRoleHint === "commentary"
    || packet.sourceRoleHint === "unknown"
    || packet.evidenceGaps.includes("No inspectable product site")
    || (packet.repositories.length === 0 && packet.sites.length === 0);
}

function allowedProjectUrl(value: string | null, post: FeedPost, packet: InvestigationPacket) {
  const allowed = [
    ...post.externalUrls,
    ...packet.sites.map((site) => site.url),
    ...packet.repositories.map((repository) => repository.url),
  ];
  if (value) {
    try {
      const wanted = new URL(value);
      const match = allowed.find((item) => {
        try {
          const candidate = new URL(item);
          return candidate.hostname === wanted.hostname && candidate.pathname.replace(/\/$/, "") === wanted.pathname.replace(/\/$/, "");
        } catch {
          return false;
        }
      });
      if (match) return match;
    } catch {
      // Fall through to verified packet URLs.
    }
  }
  return packet.sites.find((site) => !site.unavailableReason)?.url
    ?? packet.repositories.find((repository) => !repository.unavailableReason)?.url
    ?? null;
}

function normalizeEventKey(value: string, packet: InvestigationPacket) {
  const cleaned = value.trim().toLowerCase().replace(/\s+/g, "-").slice(0, 180);
  return /^(?:domain|github|project|post):[a-z0-9._:/-]+$/.test(cleaned) ? cleaned : packet.canonicalEventKey;
}

function normalizedMiniVerdict(post: FeedPost, packet: InvestigationPacket, raw: RawInvestigatorVerdict, result: ResponsesResult, usedWebSearch: boolean): InvestigatorVerdict {
  const sourceRole = sourceRoles.includes(raw.sourceRole) ? raw.sourceRole : packet.sourceRoleHint;
  const sourceAuthority = clamp(raw.sourceAuthority);
  const founderCare = clamp(raw.founderCare);
  const productSubstance = clamp(raw.productSubstance);
  const marketPotential = clamp(raw.marketPotential);
  const differentiation = clamp(raw.differentiation);
  const credibility = clamp(raw.credibility);
  const evidenceConfidence = clamp(raw.evidenceConfidence);
  const investorRelevance = clamp(raw.investorRelevance);
  const worthFiveMinutes = clamp(raw.worthFiveMinutes);
  const slopFlags = Array.isArray(raw.slopFlags)
    ? raw.slopFlags.filter((item): item is string => typeof item === "string").map((item) => item.toLowerCase().replace(/\s+/g, "_").slice(0, 80)).slice(0, 8)
    : [];
  const deterministicMismatch = hasThinClaimArtifactMismatch(post, packet);
  const establishedResurface = hasEstablishedProjectResurface(post, packet);
  if (deterministicMismatch && !slopFlags.includes("deterministic_claim_artifact_mismatch")) {
    slopFlags.unshift("deterministic_claim_artifact_mismatch");
  }
  if (establishedResurface && !slopFlags.includes("established_project_resurfaced_without_new_launch")) {
    slopFlags.unshift("established_project_resurfaced_without_new_launch");
  }
  const hardSlop = deterministicMismatch || establishedResurface
    || slopFlags.some((flag) => /claim.*mismatch|not_a_product|news_commentary|repository.*only.*landing|thin_repo.*claims|scam|token_promotion/.test(flag));
  const proposedOfficialSource = typeof raw.officialSourceUrl === "string" && /^https?:\/\//.test(raw.officialSourceUrl) ? raw.officialSourceUrl : null;
  const knownOfficialUrls = new Set([
    post.url,
    ...post.externalUrls,
    ...packet.sites.map((site) => site.url),
    ...packet.repositories.map((repository) => repository.url),
  ]);
  const officialSourceUrl = proposedOfficialSource && (usedWebSearch || knownOfficialUrls.has(proposedOfficialSource))
    ? proposedOfficialSource
    : (["official", "creator", "team_member"] as InvestigatorSourceRole[]).includes(sourceRole)
      ? post.url
      : null;
  const passesShortlist = worthFiveMinutes >= 70
    && investorRelevance >= 68
    && productSubstance >= 60
    && founderCare >= 55
    && credibility >= 60
    && evidenceConfidence >= 55
    && (!(["commentary", "unknown"] as InvestigatorSourceRole[]).includes(sourceRole) || Boolean(officialSourceUrl));
  const requestedDecision = miniDecisions.includes(raw.decision) ? raw.decision : "reject";
  const decision: InvestigatorDecision = hardSlop
    ? "reject"
    : requestedDecision === "shortlist" && !passesShortlist
      ? "watch"
      : requestedDecision === "watch" && worthFiveMinutes < 50
        ? "reject"
        : requestedDecision;
  const inputTokens = result.usage?.input_tokens ?? 0;
  const outputTokens = result.usage?.output_tokens ?? 0;
  return {
    postId: post.id,
    contentHash: feedPostContentHash(post),
    version: INVESTIGATOR_VERSION,
    model: env.investigatorModel,
    decision,
    sourceRole,
    officialSourceUrl,
    canonicalEventKey: normalizeEventKey(raw.canonicalEventKey, packet),
    sourceAuthority,
    founderCare,
    productSubstance,
    marketPotential,
    differentiation,
    credibility,
    evidenceConfidence,
    investorRelevance,
    worthFiveMinutes,
    projectKey: typeof raw.projectKey === "string" && raw.projectKey.trim() ? raw.projectKey.trim().slice(0, 100) : null,
    projectUrl: allowedProjectUrl(raw.projectUrl, post, packet),
    description: typeof raw.description === "string" && raw.description.trim() ? raw.description.replace(/\s+/g, " ").trim().slice(0, 240) : null,
    rejectionReason: decision === "reject"
      ? (deterministicMismatch
        ? "The repository is predominantly a tiny marketing site or site utility and does not substantiate the post's broad technical claims."
        : establishedResurface
          ? "This is an established project being resurfaced without evidence of a concrete new launch or release."
        : typeof raw.rejectionReason === "string" && raw.rejectionReason.trim() ? raw.rejectionReason.replace(/\s+/g, " ").trim().slice(0, 500) : "The product did not clear Scout's evidence-based investor bar.")
      : null,
    slopFlags,
    evidence: Array.isArray(raw.evidence) ? raw.evidence.filter((item): item is string => typeof item === "string").map((item) => item.replace(/\s+/g, " ").trim().slice(0, 350)).slice(0, 5) : [],
    inputTokens,
    outputTokens,
    costMicros: modelCostMicros(env.investigatorModel, inputTokens, outputTokens) + (usedWebSearch ? 10_000 : 0),
    webSearches: usedWebSearch ? 1 : 0,
    analyzedAt: Date.now(),
  };
}

async function investigateOne(post: FeedPost, packet: InvestigationPacket, useWebSearch: boolean) {
  const content: Array<Record<string, unknown>> = [{
    type: "input_text",
    text: JSON.stringify({
      post: {
        id: post.id,
        url: post.url,
        author: `@${post.username}`,
        displayName: post.displayName,
        text: post.text,
        publishedAt: new Date(post.publishedAt).toISOString(),
        engagement: { likes: post.likes, reposts: post.reposts, replies: post.replies, views: post.views },
      },
      packet: promptPacket(packet),
    }),
  }];
  const paths = [
    ...packet.sites.map((site) => site.screenshotPath).filter((item): item is string => Boolean(item)).slice(0, 1),
    ...packet.media.framePaths.slice(0, 3),
  ];
  for (const pathname of paths) {
    try {
      content.push(await imageContent(pathname));
    } catch {
      // Text and deterministic evidence remain useful if a cached image disappeared.
    }
  }
  const result = await responseRequest({
    model: env.investigatorModel,
    ...(useWebSearch ? { tools: [{ type: "web_search", search_context_size: "low" }], max_tool_calls: 1 } : {}),
    instructions: investigatorInstructions,
    input: [{ role: "user", content }],
    text: { format: { type: "json_schema", name: "scout_investigator_verdict", strict: true, schema: verdictSchema } },
  });
  const text = outputText(result);
  if (!text) throw new Error(`Investigator returned no verdict for ${post.id}`);
  return normalizedMiniVerdict(post, packet, JSON.parse(text) as RawInvestigatorVerdict, result, useWebSearch);
}

function dedupeFinalists(verdicts: InvestigatorVerdict[]) {
  const byEvent = new Map<string, InvestigatorVerdict>();
  for (const verdict of [...verdicts].sort((a, b) => b.worthFiveMinutes - a.worthFiveMinutes)) {
    if (!byEvent.has(verdict.canonicalEventKey)) byEvent.set(verdict.canonicalEventKey, verdict);
  }
  return [...byEvent.values()]
    .filter((verdict) => verdict.decision === "shortlist" || (verdict.decision === "watch" && verdict.worthFiveMinutes >= 72))
    .sort((a, b) => b.worthFiveMinutes - a.worthFiveMinutes)
    .slice(0, env.investigatorFinalistLimit);
}

function reconcileCachedVerdict(post: FeedPost, packet: InvestigationPacket, verdict: InvestigatorVerdict) {
  const deterministicMismatch = hasThinClaimArtifactMismatch(post, packet);
  const establishedResurface = hasEstablishedProjectResurface(post, packet);
  const staleEstablishedFlag = verdict.slopFlags.includes("established_project_resurfaced_without_new_launch") && !establishedResurface;
  const baseVerdict: InvestigatorVerdict = staleEstablishedFlag
    ? {
      ...verdict,
      decision: verdict.worthFiveMinutes >= 75 ? "publish" : "watch",
      rejectionReason: null,
      slopFlags: verdict.slopFlags.filter((flag) => flag !== "established_project_resurfaced_without_new_launch"),
    }
    : verdict;
  const correctedSourceRole = packet.sourceRoleHint === "commentary" && baseVerdict.sourceRole === "creator"
    ? "commentary" as const
    : baseVerdict.sourceRole;
  if (deterministicMismatch) {
    return {
      ...baseVerdict,
      decision: "reject" as const,
      sourceRole: correctedSourceRole,
      rejectionReason: "The repository is predominantly a tiny marketing site or site utility and does not substantiate the post's broad technical claims.",
      slopFlags: [...new Set(["deterministic_claim_artifact_mismatch", ...baseVerdict.slopFlags])].slice(0, 8),
      analyzedAt: Date.now(),
    };
  }
  if (establishedResurface) {
    return {
      ...baseVerdict,
      decision: "reject" as const,
      sourceRole: correctedSourceRole,
      rejectionReason: "This is an established project being resurfaced without evidence of a concrete new launch or release.",
      slopFlags: [...new Set(["established_project_resurfaced_without_new_launch", ...baseVerdict.slopFlags])].slice(0, 8),
      analyzedAt: Date.now(),
    };
  }
  if (baseVerdict.decision === "watch" && baseVerdict.worthFiveMinutes < 50) {
    return {
      ...baseVerdict,
      decision: "reject" as const,
      sourceRole: correctedSourceRole,
      rejectionReason: baseVerdict.rejectionReason ?? "The product did not clear Scout's evidence-based investor bar.",
      analyzedAt: Date.now(),
    };
  }
  return correctedSourceRole === baseVerdict.sourceRole && !staleEstablishedFlag
    ? baseVerdict
    : { ...baseVerdict, sourceRole: correctedSourceRole, analyzedAt: Date.now() };
}

async function finalJudge(verdicts: InvestigatorVerdict[], postById: Map<string, FeedPost>) {
  const finalists = dedupeFinalists(verdicts);
  if (!finalists.length) return { verdicts, judged: 0, costMicros: 0 };
  const result = await responseRequest({
    model: env.investigatorJudgeModel,
    instructions: `${finalInstructions}\n\nThe maximum publish count is ${env.investigatorPublishLimit}.`,
    input: JSON.stringify(finalists.map((verdict) => {
      const post = postById.get(verdict.postId)!;
      return {
        postId: verdict.postId,
        author: `@${post.username}`,
        text: post.text,
        engagement: { likes: post.likes, reposts: post.reposts, replies: post.replies, views: post.views },
        verdict,
      };
    })),
    text: { format: { type: "json_schema", name: "scout_investigator_final", strict: true, schema: finalSchema } },
  }, 150_000);
  const text = outputText(result);
  if (!text) throw new Error("Final investigator judge returned no decisions");
  const parsed = JSON.parse(text) as { decisions?: Array<{ postId: string; decision: "reject" | "watch" | "publish"; rank: number; worthFiveMinutes: number; reason: string }> };
  const expected = new Set(finalists.map((verdict) => verdict.postId));
  const returned = (parsed.decisions ?? []).filter((item) => expected.has(item.postId));
  if (new Set(returned.map((item) => item.postId)).size !== expected.size) throw new Error("Final investigator judge omitted candidates");
  const ordered = returned.sort((a, b) => a.rank - b.rank || b.worthFiveMinutes - a.worthFiveMinutes);
  let published = 0;
  const decisionById = new Map(ordered.map((item) => {
    const finalDecision: InvestigatorDecision = item.decision === "publish" && published < env.investigatorPublishLimit
      ? (published += 1, "publish")
      : item.decision === "publish"
        ? "watch"
        : item.decision;
    return [item.postId, { ...item, decision: finalDecision }];
  }));
  const inputShare = Math.ceil((result.usage?.input_tokens ?? 0) / finalists.length);
  const outputShare = Math.ceil((result.usage?.output_tokens ?? 0) / finalists.length);
  const costShare = Math.ceil(modelCostMicros(env.investigatorJudgeModel, result.usage?.input_tokens ?? 0, result.usage?.output_tokens ?? 0) / finalists.length);
  const updated = verdicts.map((verdict) => {
    const final = decisionById.get(verdict.postId);
    if (!final) return verdict.decision === "shortlist" ? { ...verdict, decision: "watch" as const } : verdict;
    return {
      ...verdict,
      model: `${verdict.model}+${env.investigatorJudgeModel}`,
      decision: final.decision,
      worthFiveMinutes: clamp(final.worthFiveMinutes),
      rejectionReason: final.decision === "reject" ? final.reason.slice(0, 500) : null,
      evidence: [final.reason.slice(0, 350), ...verdict.evidence].slice(0, 5),
      inputTokens: verdict.inputTokens + inputShare,
      outputTokens: verdict.outputTokens + outputShare,
      costMicros: verdict.costMicros + costShare,
      analyzedAt: Date.now(),
    };
  });
  return {
    verdicts: updated,
    judged: finalists.length,
    costMicros: modelCostMicros(env.investigatorJudgeModel, result.usage?.input_tokens ?? 0, result.usage?.output_tokens ?? 0),
  };
}

export type InvestigatorRun = {
  candidates: number;
  packetsBuilt: number;
  packetsCached: number;
  screenshotsCaptured: number;
  analyzed: number;
  cached: number;
  webSearches: number;
  judged: number;
  published: number;
  watched: number;
  rejected: number;
  inputTokens: number;
  outputTokens: number;
  costMicros: number;
  verdicts: InvestigatorVerdict[];
};

export async function runInvestigatorPipeline(posts: FeedPost[], options: { force?: boolean; refreshEvidence?: boolean } = {}): Promise<InvestigatorRun> {
  if (!env.oaiApiKey) throw new Error("OAI_API_KEY is not configured");
  const candidates = selectInvestigatorCandidates(posts);
  const packets: InvestigationPacket[] = [];
  let packetsBuilt = 0;
  let packetsCached = 0;
  for (let index = 0; index < candidates.length; index += 2) {
    const batch = await Promise.all(candidates.slice(index, index + 2).map(async ({ post, analysis }) => {
      const inspection = getCachedArtifactInspection(post);
      return buildInvestigationPacket(post, analysis, inspection, Boolean(options.force || options.refreshEvidence));
    }));
    for (const result of batch) {
      packets.push(result.packet);
      if (result.cached) packetsCached += 1;
      else packetsBuilt += 1;
    }
  }
  const screenshotsCaptured = await captureMissingSiteScreenshots(packets);
  const packetById = new Map(packets.map((packet) => [packet.postId, packet]));
  const postById = new Map(candidates.map(({ post }) => [post.id, post]));
  const rawExisting = options.force ? [] : candidates.map(({ post }) => getCachedInvestigatorVerdict(post)).filter((item): item is InvestigatorVerdict => Boolean(item));
  const existing = rawExisting.map((verdict) => reconcileCachedVerdict(postById.get(verdict.postId)!, packetById.get(verdict.postId)!, verdict));
  const existingIds = new Set(existing.map((verdict) => verdict.postId));
  const pending = candidates.filter(({ post }) => !existingIds.has(post.id));
  const searchEligible = new Set(pending
    .filter(({ post }) => needsWebSearch(packetById.get(post.id)!))
    .slice(0, env.investigatorWebSearchLimit)
    .map(({ post }) => post.id));
  const reviewed: InvestigatorVerdict[] = [...existing];
  for (let index = 0; index < pending.length; index += 2) {
    const batch = await Promise.all(pending.slice(index, index + 2).map(({ post }) =>
      investigateOne(post, packetById.get(post.id)!, searchEligible.has(post.id))));
    reviewed.push(...batch);
    saveInvestigatorVerdicts(batch);
  }
  const final = pending.length
    ? await finalJudge(reviewed, postById)
    : { verdicts: reviewed, judged: reviewed.filter((verdict) => verdict.model.includes(env.investigatorJudgeModel)).length, costMicros: 0 };
  saveInvestigatorVerdicts(final.verdicts);
  return {
    candidates: candidates.length,
    packetsBuilt,
    packetsCached,
    screenshotsCaptured,
    analyzed: pending.length,
    cached: existing.length,
    webSearches: final.verdicts.reduce((sum, verdict) => sum + verdict.webSearches, 0),
    judged: final.judged,
    published: final.verdicts.filter((verdict) => verdict.decision === "publish").length,
    watched: final.verdicts.filter((verdict) => verdict.decision === "watch" || verdict.decision === "shortlist").length,
    rejected: final.verdicts.filter((verdict) => verdict.decision === "reject").length,
    inputTokens: final.verdicts.reduce((sum, verdict) => sum + verdict.inputTokens, 0),
    outputTokens: final.verdicts.reduce((sum, verdict) => sum + verdict.outputTokens, 0),
    costMicros: final.verdicts.reduce((sum, verdict) => sum + verdict.costMicros, 0),
    verdicts: final.verdicts.sort((a, b) => b.worthFiveMinutes - a.worthFiveMinutes),
  };
}
