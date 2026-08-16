function boundedInteger(value: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.floor(parsed))) : fallback;
}

function sessionCookie(value: string | undefined) {
  const parsed = value?.trim() ?? "";
  if (/\r|\n|;/.test(parsed)) throw new Error("X session cookies must be provided as values only");
  return parsed;
}

export const env = {
  xScrapingEnabled: process.env.X_SCRAPING_ENABLED?.trim().toLowerCase() === "true",
  xAuthToken: sessionCookie(process.env.X_AUTH_TOKEN),
  xCt0: sessionCookie(process.env.X_CT0),
  xMaxPostsPerQuery: boundedInteger(process.env.X_MAX_POSTS_PER_QUERY, 50, 1, 50),
  xDiscoveryCandidateLimit: boundedInteger(process.env.SCOUT_X_DISCOVERY_LIMIT, 600, 100, 1_000),
  oaiApiKey: process.env.OAI_API_KEY?.trim() ?? "",
  analystModel: process.env.SCOUT_ANALYST_MODEL?.trim() || "gpt-5.4-nano",
  analystDailyCandidateLimit: boundedInteger(process.env.SCOUT_ANALYST_DAILY_LIMIT, 300, 1, 500),
  analystBatchSize: boundedInteger(process.env.SCOUT_ANALYST_BATCH_SIZE, 10, 1, 20),
  artifactUrlsPerPost: boundedInteger(process.env.SCOUT_ARTIFACT_URLS_PER_POST, 3, 1, 5),
  candidateLinkEnrichmentLimit: boundedInteger(process.env.SCOUT_LINK_ENRICHMENT_LIMIT, 60, 0, 200),
  visualReviewLimit: boundedInteger(process.env.SCOUT_VISUAL_REVIEW_LIMIT, 30, 0, 50),
  webSearchLimit: boundedInteger(process.env.SCOUT_WEB_SEARCH_LIMIT, 5, 0, 20),
  visualModel: process.env.SCOUT_VISUAL_MODEL?.trim() || "gpt-5.4-mini",
  rerankModel: process.env.SCOUT_RERANK_MODEL?.trim() || "gpt-5.4",
  investigatorReviewLimit: boundedInteger(process.env.SCOUT_INVESTIGATOR_REVIEW_LIMIT, 30, 1, 50),
  investigatorWebSearchLimit: boundedInteger(process.env.SCOUT_INVESTIGATOR_WEB_SEARCH_LIMIT, 10, 0, 30),
  investigatorFinalistLimit: boundedInteger(process.env.SCOUT_INVESTIGATOR_FINALIST_LIMIT, 15, 1, 30),
  investigatorPublishLimit: boundedInteger(process.env.SCOUT_INVESTIGATOR_PUBLISH_LIMIT, 8, 1, 15),
  investigatorModel: process.env.SCOUT_INVESTIGATOR_MODEL?.trim() || "gpt-5.4-mini",
  investigatorJudgeModel: process.env.SCOUT_INVESTIGATOR_JUDGE_MODEL?.trim() || "gpt-5.4",
  githubToken: process.env.GITHUB_TOKEN?.trim() ?? "",
};

export function xSessionConfigured() {
  return env.xScrapingEnabled && Boolean(env.xAuthToken && env.xCt0);
}

export function analystConfigured() {
  return Boolean(env.oaiApiKey);
}
