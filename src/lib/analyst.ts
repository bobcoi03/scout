import type { ArtifactInspection, FeedPost, PostAnalysis } from "@/db";
import {
  ANALYSIS_VERSION,
  feedPostContentHash,
  getCachedPostAnalysis,
  savePostAnalyses,
} from "@/db";
import { analystConfigured, env } from "@/lib/env";
import { artifactPromptEvidence, hasHardArtifactRejection, hasUsableArtifact } from "@/lib/artifact-inspector";
import { isCryptoPromotionText } from "@/lib/signal-filters";

const signalTypes = [
  "product_launch",
  "open_source_launch",
  "product_demo",
  "new_founder",
  "research_signal",
  "discussion",
  "news",
  "roundup",
  "promotion",
] as const;
const relationships = ["creator", "team_member", "curator", "commentator", "unknown"] as const;
const artifactTypes = ["product", "repository", "company", "personal_site", "content_archive"] as const;
const keepableSignals = new Set<string>(["product_launch", "open_source_launch", "product_demo", "new_founder", "research_signal"]);
const directFirstPartyPattern = /\b(?:(?:i|we|my co-?founders? and i|our team)\b[\s\S]{0,35}\b(?:built|made|created|launched|launching|released|releasing|open[ -]?sourced|shipped|shipping|developed|founded|starting)|(?:built|made|created|launched|released|shipped)\s+by\s+(?:me|us))\b/i;
const viralHookPattern = /\b(?:nobody tells you|save this|bookmark this|here are the \d+|broke my feed|full prompt breakdown|exact workflow|you won'?t believe)\b/i;

type RawVerdict = {
  postId: string;
  keep: boolean;
  signalType: string;
  relationship: string;
  artifactType: string | null;
  newArtifact: boolean;
  analystScore: number;
  investorRelevance: number;
  seoProbability: number;
  confidence: number;
  projectKey: string | null;
  projectUrl: string | null;
  description: string | null;
  rejectionReason: string | null;
  evidence: string[];
};

type ResponsesResult = {
  output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { message?: string };
};

const responseSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    analyses: {
      type: "array",
      minItems: 1,
      maxItems: 20,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          postId: { type: "string" },
          keep: { type: "boolean" },
          signalType: { type: "string", enum: signalTypes },
          relationship: { type: "string", enum: relationships },
          artifactType: { type: ["string", "null"], enum: [...artifactTypes, null] },
          newArtifact: { type: "boolean" },
          analystScore: { type: "integer", minimum: 0, maximum: 100 },
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
          "postId", "keep", "signalType", "relationship", "artifactType", "newArtifact",
          "analystScore", "investorRelevance", "seoProbability", "confidence", "projectKey",
          "projectUrl", "description", "rejectionReason", "evidence",
        ],
      },
    },
  },
  required: ["analyses"],
} as const;

const analystInstructions = `You are Scout's first-pass product discovery analyst. Review an X post together with evidence fetched from its linked product pages. Your job is to preserve plausible high-quality launch candidates for a later visual review while removing obvious junk.

KEEP a concrete product, repository, company, or demo launch when the tweet and artifact evidence together make it plausibly real and newly launched or meaningfully updated today. First-party creator/team posts are preferred, but an official product account or a credible third-party post about an important launch may qualify. Do not discard a strong launch solely because the company or repository already existed; distinguish a meaningful new release from recycled promotion.

REJECT generic commentary/news with no concrete launch, motivational posts, roundups, directories, resource lists, newsletters, personal portfolios, engagement bait, SEO/tutorial posts, vague ideas, trivial hackathon shells, and artifacts whose linked page is parked, unavailable, unrelated, or only a generic signup screen with no product evidence. A page that resolves to a domain-for-sale/parking service is a hard negative. Mentioning "AI", "open source", "built", or "launch" is not evidence by itself.

HARD REJECT token promotions and cryptocurrency scams, not crypto as a category. Reject ticker-style $TOKEN, contract addresses or "CA:", airdrops, presales, memecoins, token launches, buyback/burn tokenomics, guaranteed-return or "100x" claims, giveaways/whitelists, claims that product activity increases token value, and posts whose main purpose is getting readers to buy or claim a token.

DO NOT reject a project merely because it uses crypto, blockchain, Solana, Ethereum, a DEX, or perpetual markets. Real crypto products can qualify: perpetual/trading applications, social-trading apps, exchanges and marketplaces, wallets, payments, analytics, security products, consumer protocols, and developer infrastructure. Judge them by the same early-stage standard as any other project: the author or team must be first-party and the post must show a concrete new product, repository, demo, or launch. A launch video, usable product, named project, and credible evidence that a real team built it are positive evidence, but never excuse token-promotion or scam signals.

Known negative examples:
- StartupArchive quoting Elon about "starting a company": historical aggregator content, not a new founder.
- MelvinInvests discussing Databricks GPU demand: investing/news commentary.
- RoundtableSpace promoting hundreds of cybersecurity resources: roundup/SEO, not a new project.
- Jun Song worrying about Open Source AI: discussion, not an open-source launch.
- Netrovert launching a personal website and content archive: personal brand content, not an investable product.
- A personal account describing PhoneInfoga without saying they built it: third-party open-source promotion.
- Ramp launching a router already used for 70,000 customers: a mature-company product update.
- "I BUILT AN AI INFLUENCER" followed by "nobody tells you", timestamps, a follow request, and a prompt breakdown, with no named product: creator SEO/tutorial content rather than a startup discovery.
- ProbaBall promoting $Probaball, a Solana prediction market, contract address, protocol-fee token buybacks, and token value: hard reject as a cryptocurrency promotion.

Tiny projects can be excellent, but "tiny" is not a quality signal. Reward visible product depth, technical specificity, visual craft, novelty, credibility, and investor relevance. For any kept product/repository/company, projectKey must contain its stable concise name. Write description as one factual sentence of at most 180 characters explaining what the project does. Select projectUrl only from supplied tweet URLs or artifact URLs; prefer the actual product homepage, GitHub repository, or App Store page. Set seoProbability high for tutorial threads, follow requests, prompt breakdowns, generic viral hooks, and unnamed demos. analystScore is a provisional quality score; 80+ requires unusually strong evidence. Ignore raw engagement.

Return exactly one analysis for every input postId. Copy each postId exactly, do not omit posts, and do not return IDs that were not supplied.`;

function clampScore(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, Math.round(number))) : 0;
}

function asEnum(value: unknown, allowed: readonly string[], fallback: string) {
  return typeof value === "string" && allowed.includes(value) ? value : fallback;
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

function selectedProjectUrl(value: unknown, post: FeedPost, inspection?: ArtifactInspection | null) {
  const allowedUrls = [...post.externalUrls, ...(inspection?.targets.flatMap((target) => [target.requestedUrl, target.finalUrl].filter((url): url is string => Boolean(url))) ?? [])];
  if (typeof value === "string") {
    const wanted = comparableUrl(value);
    const match = wanted && allowedUrls.find((url) => comparableUrl(url) === wanted);
    if (match) return match;
  }
  const usableTarget = inspection?.targets.find((target) => !target.parked && !target.unavailable && !target.cryptoPromotion);
  return usableTarget?.finalUrl ?? usableTarget?.requestedUrl ?? (post.externalUrls.length === 1 ? post.externalUrls[0] : null);
}

function normalizeVerdict(value: RawVerdict, post: FeedPost, inspection: ArtifactInspection | null | undefined, usage: { input: number; output: number }, batchSize: number): PostAnalysis {
  const signalType = asEnum(value.signalType, signalTypes, "promotion");
  const relationship = asEnum(value.relationship, relationships, "unknown");
  const artifactType = value.artifactType === null ? null : asEnum(value.artifactType, artifactTypes, "content_archive");
  const analystScore = clampScore(value.analystScore);
  const investorRelevance = clampScore(value.investorRelevance);
  const seoProbability = clampScore(value.seoProbability);
  const confidence = clampScore(value.confidence);
  const modelSaysKeep = Boolean(value.keep);
  const projectKey = typeof value.projectKey === "string" && value.projectKey.trim() ? value.projectKey.trim().toLowerCase() : null;
  const normalizedProject = projectKey?.replace(/[^a-z0-9]/g, "") ?? "";
  const normalizedAuthor = `${post.username} ${post.displayName ?? ""}`.toLowerCase().replace(/[^a-z0-9]/g, "");
  const officialProjectAccount = normalizedProject.length >= 4 && normalizedAuthor.includes(normalizedProject);
  const hasFirstPartyEvidence = directFirstPartyPattern.test(post.text) || officialProjectAccount;
  const hasUnnamedViralHook = viralHookPattern.test(post.text) && !projectKey;
  const hasCryptoPromotion = isCryptoPromotionText(post.text) || Boolean(inspection?.targets.some((target) => target.cryptoPromotion));
  const artifactRejected = hasHardArtifactRejection(inspection);
  const usableArtifact = hasUsableArtifact(inspection);
  const projectUrl = selectedProjectUrl(value.projectUrl, post, inspection);
  const description = typeof value.description === "string" && value.description.trim() ? value.description.replace(/\s+/g, " ").trim().slice(0, 240) : null;
  const passesGate = keepableSignals.has(signalType)
    && (Boolean(value.newArtifact) || signalType === "product_launch" || signalType === "open_source_launch")
    && artifactType !== "personal_site"
    && artifactType !== "content_archive"
    && investorRelevance >= 45
    && seoProbability <= 70
    && (hasFirstPartyEvidence || officialProjectAccount || (usableArtifact && analystScore >= 65))
    && !hasUnnamedViralHook
    && !hasCryptoPromotion
    && !artifactRejected;
  const deterministicRejection = hasCryptoPromotion
    ? "Token promotion or cryptocurrency scam signals are excluded from Scout."
    : artifactRejected
      ? "The linked artifact is parked, unavailable, or otherwise fails basic product verification."
      : !hasFirstPartyEvidence && !usableArtifact
        ? "No first-party authorship or independently usable product artifact was found."
        : hasUnnamedViralHook
        ? "Viral tutorial/SEO hooks without a named project are not a startup discovery signal."
        : "Failed Scout's deterministic quality gate.";
  const inputTokens = Math.ceil(usage.input / Math.max(1, batchSize));
  const outputTokens = Math.ceil(usage.output / Math.max(1, batchSize));
  const costUsd = inputTokens * 0.2 / 1_000_000 + outputTokens * 1.25 / 1_000_000;
  return {
    postId: post.id,
    contentHash: feedPostContentHash(post),
    promptVersion: ANALYSIS_VERSION,
    model: env.analystModel,
    keep: modelSaysKeep && passesGate,
    signalType,
    relationship,
    artifactType,
    newArtifact: Boolean(value.newArtifact),
    analystScore,
    investorRelevance,
    seoProbability,
    confidence,
    projectKey,
    projectUrl: modelSaysKeep && passesGate ? projectUrl : null,
    description: modelSaysKeep && passesGate ? description : null,
    rejectionReason: modelSaysKeep && passesGate ? null : (modelSaysKeep ? deterministicRejection : (typeof value.rejectionReason === "string" ? value.rejectionReason.slice(0, 500) : deterministicRejection)),
    evidence: Array.isArray(value.evidence) ? value.evidence.filter((item): item is string => typeof item === "string").slice(0, 3) : [],
    inputTokens,
    outputTokens,
    costMicros: Math.max(0, Math.round(costUsd * 1_000_000)),
    analyzedAt: Date.now(),
  };
}

function outputText(result: ResponsesResult) {
  for (const output of result.output ?? []) {
    for (const content of output.content ?? []) {
      if (content.type === "output_text" && content.text) return content.text;
    }
  }
  return null;
}

async function requestAnalysis(posts: FeedPost[], inspections?: Map<string, ArtifactInspection>) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90_000);
  try {
    let lastError = "Unknown OpenAI error";
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.oaiApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: env.analystModel,
          instructions: analystInstructions,
          input: JSON.stringify(posts.map((post) => ({
            postId: post.id,
            categoryFoundBySearch: post.category,
            author: `@${post.username}`,
            displayName: post.displayName,
            text: post.text,
            postUrl: post.url,
            externalUrls: post.externalUrls,
            artifactEvidence: artifactPromptEvidence(inspections?.get(post.id)),
            hasMedia: Boolean(post.mediaUrl),
            publishedAt: new Date(post.publishedAt).toISOString(),
          }))),
          text: {
            format: {
              type: "json_schema",
              name: "scout_post_analysis",
              strict: true,
              schema: responseSchema,
            },
          },
        }),
        signal: controller.signal,
      });
      const result = await response.json() as ResponsesResult;
      if (response.ok) {
        const text = outputText(result);
        if (!text) throw new Error("OpenAI returned no structured output text");
        const parsed = JSON.parse(text) as { analyses?: RawVerdict[] };
        if (!Array.isArray(parsed.analyses)) throw new Error("OpenAI returned an invalid analyses payload");
        return {
          verdicts: parsed.analyses,
          usage: { input: result.usage?.input_tokens ?? 0, output: result.usage?.output_tokens ?? 0 },
        };
      }
      lastError = result.error?.message ?? `OpenAI request failed with ${response.status}`;
      if (response.status !== 429 && response.status < 500) break;
      await new Promise((resolve) => setTimeout(resolve, 1_500));
    }
    throw new Error(lastError);
  } finally {
    clearTimeout(timeout);
  }
}

export type AnalystRun = {
  candidates: number;
  cached: number;
  analyzed: number;
  accepted: number;
  rejected: number;
  inputTokens: number;
  outputTokens: number;
  costMicros: number;
};

export async function analyzeFeedPosts(posts: FeedPost[], inspections = new Map<string, ArtifactInspection>()): Promise<AnalystRun> {
  if (!analystConfigured()) throw new Error("OAI_API_KEY is not configured");
  const limited = posts.slice(0, env.analystDailyCandidateLimit);
  const cached = limited.map((post) => getCachedPostAnalysis(post)).filter((item): item is PostAnalysis => Boolean(item));
  const cachedIds = new Set(cached.map((item) => item.postId));
  const pending = limited.filter((post) => !cachedIds.has(post.id));
  const saved: PostAnalysis[] = [];

  for (let index = 0; index < pending.length; index += env.analystBatchSize) {
    let missing = pending.slice(index, index + env.analystBatchSize);

    // Structured output guarantees the shape of each verdict, but it cannot
    // guarantee that the model returns every supplied postId. Preserve valid
    // verdicts and retry only omissions; after the first response this normally
    // becomes a cheap single-post recovery request.
    for (let attempt = 0; attempt < 3 && missing.length; attempt += 1) {
      const result = await requestAnalysis(missing, inspections);
      const expectedIds = new Set(missing.map((post) => post.id));
      const verdictById = new Map(result.verdicts
        .filter((verdict) => expectedIds.has(verdict.postId))
        .map((verdict) => [verdict.postId, verdict]));
      const completed = missing.filter((post) => verdictById.has(post.id));

      for (const post of completed) {
        saved.push(normalizeVerdict(verdictById.get(post.id)!, post, inspections.get(post.id), result.usage, completed.length));
      }
      if (saved.length) savePostAnalyses(saved.splice(0));
      missing = missing.filter((post) => !verdictById.has(post.id));
    }

    if (missing.length) {
      throw new Error(`OpenAI repeatedly omitted analysis for ${missing.length} post${missing.length === 1 ? "" : "s"}: ${missing.map((post) => post.id).join(", ")}`);
    }
  }

  const all = limited.map((post) => getCachedPostAnalysis(post)).filter((item): item is PostAnalysis => Boolean(item));
  return {
    candidates: limited.length,
    cached: cached.length,
    analyzed: pending.length,
    accepted: all.filter((item) => item.keep).length,
    rejected: all.filter((item) => !item.keep).length,
    inputTokens: all.reduce((sum, item) => sum + item.inputTokens, 0),
    outputTokens: all.reduce((sum, item) => sum + item.outputTokens, 0),
    costMicros: all.reduce((sum, item) => sum + item.costMicros, 0),
  };
}
