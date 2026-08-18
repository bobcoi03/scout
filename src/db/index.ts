import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { isCryptoPromotionText } from "@/lib/signal-filters";

export type FeedCategory = "New releases" | "Open source" | "Product demos" | "New founders";

export type FeedPost = {
  id: string;
  category: FeedCategory;
  url: string;
  username: string;
  displayName: string | null;
  text: string;
  publishedAt: number;
  likes: number;
  reposts: number;
  replies: number;
  views: number;
  mediaUrl: string | null;
  externalUrls: string[];
  score: number;
  fetchedAt: number;
};

export type FeedScan = {
  id: number;
  status: "running" | "completed" | "failed";
  startedAt: number;
  completedAt: number | null;
  foundCount: number;
  savedCount: number;
  scanDay: string | null;
  analysisVersion: number | null;
  investigatorVersion: number | null;
  error: string | null;
};

export const ANALYSIS_VERSION = 6;
export const ARTIFACT_INSPECTION_VERSION = 1;
export const INVESTIGATOR_VERSION = 1;

export type ArtifactTargetEvidence = {
  requestedUrl: string;
  finalUrl: string | null;
  status: number | null;
  contentType: string | null;
  title: string | null;
  description: string | null;
  pageText: string;
  parked: boolean;
  unavailable: boolean;
  cryptoPromotion: boolean;
  github: {
    fullName: string;
    description: string | null;
    createdAt: string;
    updatedAt: string;
    stars: number;
    forks: number;
    archived: boolean;
  } | null;
  error: string | null;
};

export type WebEvidence = {
  officialUrl: string | null;
  launchDate: string | null;
  established: boolean;
  summary: string;
  sources: Array<{ title: string; url: string }>;
};

export type ArtifactInspection = {
  postId: string;
  contentHash: string;
  inspectionVersion: number;
  targets: ArtifactTargetEvidence[];
  webEvidence: WebEvidence | null;
  screenshotPath: string | null;
  inspectedAt: number;
};

export type InvestigatorSourceRole = "official" | "creator" | "team_member" | "credible_third_party" | "commentary" | "unknown";
export type InvestigatorDecision = "reject" | "watch" | "shortlist" | "publish";

export type InvestigatorProfileEvidence = {
  username: string;
  name: string | null;
  biography: string | null;
  website: string | null;
  joinedAt: string | null;
  accountAgeDays: number | null;
  followers: number | null;
  following: number | null;
  posts: number | null;
  listed: number | null;
  verified: boolean;
  recentPosts: Array<{ text: string; likes: number; reposts: number; publishedAt: string | null }>;
  unavailableReason: string | null;
};

export type InvestigatorSiteEvidence = {
  url: string;
  host: string;
  title: string | null;
  description: string | null;
  textSample: string;
  temporaryHost: boolean;
  htmlBytes: number;
  internalLinkCount: number;
  externalLinkCount: number;
  notableLinks: string[];
  ctaLabels: string[];
  imageCount: number;
  videoCount: number;
  hasDocs: boolean;
  hasPricing: boolean;
  hasWorkingProductLink: boolean;
  placeholderSignals: string[];
  screenshotPath: string | null;
  unavailableReason: string | null;
};

export type InvestigatorRepositoryEvidence = {
  url: string;
  fullName: string;
  description: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  pushedAt: string | null;
  defaultBranch: string | null;
  stars: number;
  forks: number;
  watchers: number;
  openIssues: number;
  sizeKb: number;
  primaryLanguage: string | null;
  license: string | null;
  archived: boolean;
  fork: boolean;
  topics: string[];
  languages: Record<string, number>;
  contributors: number | null;
  totalFiles: number | null;
  sourceFiles: number | null;
  testFiles: number | null;
  documentationFiles: number | null;
  hasCi: boolean | null;
  rootFiles: string[];
  representativeFiles: Array<{ path: string; excerpt: string }>;
  unavailableReason: string | null;
};

export type InvestigatorMediaEvidence = {
  kind: "none" | "image" | "video";
  sourceUrl: string | null;
  durationSeconds: number | null;
  framePaths: string[];
  unavailableReason: string | null;
};

export type InvestigationPacket = {
  postId: string;
  contentHash: string;
  version: number;
  builtAt: number;
  preliminaryNewArtifact: boolean;
  preliminarySignalType: string | null;
  sourceRoleHint: InvestigatorSourceRole;
  sourceRoleReason: string;
  canonicalEventKey: string;
  profile: InvestigatorProfileEvidence;
  sites: InvestigatorSiteEvidence[];
  repositories: InvestigatorRepositoryEvidence[];
  media: InvestigatorMediaEvidence;
  artifactEvidence: unknown;
  evidenceGaps: string[];
};

export type InvestigatorVerdict = {
  postId: string;
  contentHash: string;
  version: number;
  model: string;
  decision: InvestigatorDecision;
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
  inputTokens: number;
  outputTokens: number;
  costMicros: number;
  webSearches: number;
  analyzedAt: number;
};

export type PostAnalysis = {
  postId: string;
  contentHash: string;
  promptVersion: number;
  model: string;
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
  inputTokens: number;
  outputTokens: number;
  costMicros: number;
  analyzedAt: number;
};

export type ProjectRow = {
  postId: string;
  date: number;
  category: FeedCategory;
  builderName: string;
  username: string;
  projectName: string;
  projectUrl: string | null;
  description: string | null;
  discoveryUrl: string;
  postText: string;
  mediaUrl: string | null;
  externalUrls: string[];
  likes: number;
  reposts: number;
  replies: number;
  views: number;
  discoveryScore: number;
  fetchedAt: number;
  contentHash: string;
  promptVersion: number;
  model: string;
  keep: boolean;
  signalType: string;
  relationship: string;
  artifactType: string | null;
  newArtifact: boolean;
  analystScore: number;
  investorRelevance: number;
  seoProbability: number;
  confidence: number;
  rejectionReason: string | null;
  evidence: string[];
  inputTokens: number;
  outputTokens: number;
  costMicros: number;
  analyzedAt: number;
};

export function feedPostContentHash(post: Pick<FeedPost, "username" | "text" | "url">) {
  return createHash("sha256").update(`${post.username}\n${post.url}\n${post.text}`).digest("hex");
}

const globalForDb = globalThis as unknown as {
  scoutFeedSqlite?: Database.Database;
  scoutFeedSqlitePath?: string;
};

let sqliteInstance: Database.Database | null = null;
let sqliteInstancePath: string | null = null;

function configuredDatabasePath() {
  return path.resolve(/* turbopackIgnore: true */ process.cwd(), process.env.SCOUT_DB_PATH ?? "./data/scout.db");
}

function initializeDatabase(database: Database.Database) {
  database.pragma("journal_mode = WAL");
  database.pragma("busy_timeout = 5000");
  database.exec(`
  CREATE TABLE IF NOT EXISTS x_feed_posts (
    id TEXT PRIMARY KEY,
    category TEXT NOT NULL,
    url TEXT NOT NULL UNIQUE,
    username TEXT NOT NULL,
    display_name TEXT,
    text TEXT NOT NULL,
    published_at INTEGER NOT NULL,
    likes INTEGER NOT NULL DEFAULT 0,
    reposts INTEGER NOT NULL DEFAULT 0,
    replies INTEGER NOT NULL DEFAULT 0,
    views INTEGER NOT NULL DEFAULT 0,
    media_url TEXT,
    external_urls_json TEXT NOT NULL DEFAULT '[]',
    content_hash TEXT,
    score REAL NOT NULL DEFAULT 0,
    fetched_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS x_feed_posts_score_idx ON x_feed_posts(score DESC);
  CREATE INDEX IF NOT EXISTS x_feed_posts_published_idx ON x_feed_posts(published_at DESC);

  CREATE TABLE IF NOT EXISTS post_analysis (
    post_id TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    prompt_version INTEGER NOT NULL,
    model TEXT NOT NULL,
    keep INTEGER NOT NULL,
    signal_type TEXT NOT NULL,
    relationship TEXT NOT NULL,
    artifact_type TEXT,
    new_artifact INTEGER NOT NULL,
    analyst_score REAL NOT NULL,
    investor_relevance REAL NOT NULL,
    seo_probability REAL NOT NULL,
    confidence REAL NOT NULL,
    project_key TEXT,
    project_url TEXT,
    description TEXT,
    rejection_reason TEXT,
    evidence_json TEXT NOT NULL,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cost_micros INTEGER NOT NULL DEFAULT 0,
    analyzed_at INTEGER NOT NULL,
    PRIMARY KEY (post_id, content_hash, prompt_version)
  );
  CREATE INDEX IF NOT EXISTS post_analysis_feed_idx ON post_analysis(prompt_version, keep, analyst_score DESC);
  CREATE INDEX IF NOT EXISTS post_analysis_project_idx ON post_analysis(project_key);

  CREATE TABLE IF NOT EXISTS artifact_inspections (
    post_id TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    inspection_version INTEGER NOT NULL,
    evidence_json TEXT NOT NULL,
    inspected_at INTEGER NOT NULL,
    PRIMARY KEY (post_id, content_hash, inspection_version)
  );

  CREATE TABLE IF NOT EXISTS investigation_packets (
    post_id TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    investigator_version INTEGER NOT NULL,
    evidence_json TEXT NOT NULL,
    investigated_at INTEGER NOT NULL,
    PRIMARY KEY (post_id, content_hash, investigator_version)
  );

  CREATE TABLE IF NOT EXISTS investigator_verdicts (
    post_id TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    investigator_version INTEGER NOT NULL,
    model TEXT NOT NULL,
    decision TEXT NOT NULL,
    source_role TEXT NOT NULL,
    official_source_url TEXT,
    canonical_event_key TEXT NOT NULL,
    source_authority INTEGER NOT NULL,
    founder_care INTEGER NOT NULL,
    product_substance INTEGER NOT NULL,
    market_potential INTEGER NOT NULL,
    differentiation INTEGER NOT NULL,
    credibility INTEGER NOT NULL,
    evidence_confidence INTEGER NOT NULL,
    investor_relevance INTEGER NOT NULL,
    worth_five_minutes INTEGER NOT NULL,
    project_key TEXT,
    project_url TEXT,
    description TEXT,
    rejection_reason TEXT,
    slop_flags_json TEXT NOT NULL,
    evidence_json TEXT NOT NULL,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cost_micros INTEGER NOT NULL DEFAULT 0,
    web_searches INTEGER NOT NULL DEFAULT 0,
    analyzed_at INTEGER NOT NULL,
    PRIMARY KEY (post_id, content_hash, investigator_version)
  );
  CREATE INDEX IF NOT EXISTS investigator_verdicts_feed_idx
    ON investigator_verdicts(investigator_version, decision, worth_five_minutes DESC);
  CREATE INDEX IF NOT EXISTS investigator_verdicts_event_idx
    ON investigator_verdicts(investigator_version, canonical_event_key);

  CREATE TABLE IF NOT EXISTS x_feed_scans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    status TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    completed_at INTEGER,
    found_count INTEGER NOT NULL DEFAULT 0,
    saved_count INTEGER NOT NULL DEFAULT 0,
    scan_day TEXT,
    analysis_version INTEGER,
    investigator_version INTEGER,
    error TEXT
  );
`);
  const postColumns = database.prepare("PRAGMA table_info(x_feed_posts)").all() as Array<{ name: string }>;
  if (!postColumns.some((column) => column.name === "media_url")) database.exec("ALTER TABLE x_feed_posts ADD COLUMN media_url TEXT");
  if (!postColumns.some((column) => column.name === "external_urls_json")) database.exec("ALTER TABLE x_feed_posts ADD COLUMN external_urls_json TEXT NOT NULL DEFAULT '[]'");
  if (!postColumns.some((column) => column.name === "content_hash")) database.exec("ALTER TABLE x_feed_posts ADD COLUMN content_hash TEXT");
  const analysisColumns = database.prepare("PRAGMA table_info(post_analysis)").all() as Array<{ name: string }>;
  if (!analysisColumns.some((column) => column.name === "project_url")) database.exec("ALTER TABLE post_analysis ADD COLUMN project_url TEXT");
  if (!analysisColumns.some((column) => column.name === "description")) database.exec("ALTER TABLE post_analysis ADD COLUMN description TEXT");
  const scanColumns = database.prepare("PRAGMA table_info(x_feed_scans)").all() as Array<{ name: string }>;
  if (!scanColumns.some((column) => column.name === "scan_day")) database.exec("ALTER TABLE x_feed_scans ADD COLUMN scan_day TEXT");
  if (!scanColumns.some((column) => column.name === "analysis_version")) database.exec("ALTER TABLE x_feed_scans ADD COLUMN analysis_version INTEGER");
  if (!scanColumns.some((column) => column.name === "investigator_version")) database.exec("ALTER TABLE x_feed_scans ADD COLUMN investigator_version INTEGER");

  const unhashedRows = database.prepare("SELECT id, username, url, text FROM x_feed_posts WHERE content_hash IS NULL").all() as Array<{ id: string; username: string; url: string; text: string }>;
  if (unhashedRows.length) {
    const setHash = database.prepare("UPDATE x_feed_posts SET content_hash = ? WHERE id = ?");
    database.transaction(() => {
      for (const row of unhashedRows) setHash.run(feedPostContentHash(row), row.id);
    })();
  }
}

function getSqlite() {
  const databasePath = configuredDatabasePath();
  if (sqliteInstance && sqliteInstance.open && sqliteInstancePath === databasePath) return sqliteInstance;

  if (sqliteInstance?.open) sqliteInstance.close();
  const reusable = process.env.NODE_ENV !== "production"
    && globalForDb.scoutFeedSqlite?.open
    && globalForDb.scoutFeedSqlitePath === databasePath
    ? globalForDb.scoutFeedSqlite
    : null;

  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  sqliteInstance = reusable ?? new Database(databasePath);
  sqliteInstancePath = databasePath;
  initializeDatabase(sqliteInstance);

  if (process.env.NODE_ENV !== "production") {
    globalForDb.scoutFeedSqlite = sqliteInstance;
    globalForDb.scoutFeedSqlitePath = databasePath;
  }
  return sqliteInstance;
}

const sqlite = new Proxy({} as Database.Database, {
  get(_target, property) {
    const database = getSqlite();
    const value = Reflect.get(database, property, database);
    return typeof value === "function" ? value.bind(database) : value;
  },
});

export function checkpointDatabase() {
  if (!sqliteInstance?.open) return;
  sqliteInstance.pragma("wal_checkpoint(TRUNCATE)");
}

export function closeDatabase() {
  if (!sqliteInstance?.open) return;
  checkpointDatabase();
  const closed = sqliteInstance;
  closed.close();
  sqliteInstance = null;
  sqliteInstancePath = null;
  if (globalForDb.scoutFeedSqlite === closed) {
    delete globalForDb.scoutFeedSqlite;
    delete globalForDb.scoutFeedSqlitePath;
  }
}

function parseStringArray(value: unknown) {
  try {
    const parsed = JSON.parse(String(value ?? "[]"));
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

const rowToPost = (row: Record<string, unknown>): FeedPost => ({
  id: String(row.id),
  category: row.category as FeedCategory,
  url: String(row.url),
  username: String(row.username),
  displayName: row.display_name == null ? null : String(row.display_name),
  text: String(row.text),
  publishedAt: Number(row.published_at),
  likes: Number(row.likes),
  reposts: Number(row.reposts),
  replies: Number(row.replies),
  views: Number(row.views),
  mediaUrl: row.media_url == null ? null : String(row.media_url),
  externalUrls: parseStringArray(row.external_urls_json),
  score: Number(row.score),
  fetchedAt: Number(row.fetched_at),
});

export function listFeedPosts(day?: string, limit = 80) {
  const start = day ? Date.parse(`${day}T00:00:00.000Z`) : null;
  if (day && (!Number.isFinite(start) || new Date(start!).toISOString().slice(0, 10) !== day)) throw new Error(`Invalid feed day: ${day}`);
  const end = start == null ? null : start + 86_400_000;
  return sqlite.prepare(`
    WITH investigator_days AS (
      SELECT scan_day
      FROM x_feed_scans
      WHERE status = 'completed'
        AND investigator_version = ?
        AND scan_day IS NOT NULL
      GROUP BY scan_day
    ), analysis_versions AS (
      SELECT
        a.*,
        ROW_NUMBER() OVER (
          PARTITION BY a.post_id, a.content_hash
          ORDER BY a.prompt_version DESC
        ) AS analysis_rank
      FROM post_analysis a
      WHERE a.prompt_version = ?
    ), effective AS (
      SELECT
        p.*,
        CASE
          WHEN d.scan_day IS NOT NULL AND v.post_id IS NOT NULL THEN v.worth_five_minutes
          ELSE a.analyst_score
        END AS analyst_score,
        CASE
          WHEN d.scan_day IS NOT NULL THEN CASE WHEN v.decision = 'publish' THEN 1 ELSE 0 END
          ELSE a.keep
        END AS curator_keep,
        CASE
          WHEN d.scan_day IS NOT NULL AND v.post_id IS NOT NULL
            THEN COALESCE(NULLIF(v.project_key, ''), NULLIF(v.canonical_event_key, ''), NULLIF(a.project_key, ''), p.id)
          ELSE COALESCE(NULLIF(a.project_key, ''), p.id)
        END AS curator_key
      FROM x_feed_posts p
      JOIN analysis_versions a
        ON a.post_id = p.id
        AND a.content_hash = p.content_hash
      LEFT JOIN investigator_days d
        ON d.scan_day = date(p.published_at / 1000, 'unixepoch')
      LEFT JOIN investigator_verdicts v
        ON v.post_id = p.id
        AND v.content_hash = p.content_hash
        AND v.investigator_version = ?
      WHERE a.analysis_rank = 1
        AND (? IS NULL OR (p.published_at >= ? AND p.published_at < ?))
    ), ranked AS (
      SELECT
        effective.*,
        ROW_NUMBER() OVER (
          PARTITION BY curator_key
          ORDER BY analyst_score DESC, score DESC, published_at DESC
        ) AS project_rank
      FROM effective
      WHERE curator_keep = 1
    )
    SELECT * FROM ranked
    WHERE project_rank = 1
    ORDER BY analyst_score DESC, score DESC, published_at DESC
    LIMIT ?
  `).all(INVESTIGATOR_VERSION, ANALYSIS_VERSION, INVESTIGATOR_VERSION, start, start, end, limit * 2)
    .map((row) => rowToPost(row as Record<string, unknown>))
    .filter((post) => !isCryptoPromotionText(post.text))
    .slice(0, limit);
}

// Return the complete bounded discovery pool. Each downstream pipeline owns
// its own (usually much smaller) review limit so increasing discovery recall
// does not silently increase an expensive model stage.
export function listPostsForAnalysis(day: string, limit = 1_000) {
  const start = Date.parse(`${day}T00:00:00.000Z`);
  if (!Number.isFinite(start)) throw new Error(`Invalid analysis day: ${day}`);
  return sqlite.prepare(`
    SELECT * FROM x_feed_posts
    WHERE published_at >= ? AND published_at < ?
    ORDER BY score DESC, published_at DESC
    LIMIT ?
  `).all(start, start + 86_400_000, limit).map((row) => rowToPost(row as Record<string, unknown>));
}

export function getCachedPostAnalysis(post: FeedPost, promptVersion = ANALYSIS_VERSION) {
  const row = sqlite.prepare(`
    SELECT * FROM post_analysis
    WHERE post_id = ? AND content_hash = ? AND prompt_version = ?
  `).get(post.id, feedPostContentHash(post), promptVersion) as Record<string, unknown> | undefined;
  if (!row) return null;
  return rowToAnalysis(row);
}

export function getCachedArtifactInspection(post: FeedPost, inspectionVersion = ARTIFACT_INSPECTION_VERSION) {
  const row = sqlite.prepare(`
    SELECT evidence_json FROM artifact_inspections
    WHERE post_id = ? AND content_hash = ? AND inspection_version = ?
  `).get(post.id, feedPostContentHash(post), inspectionVersion) as { evidence_json: string } | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.evidence_json) as ArtifactInspection;
  } catch {
    return null;
  }
}

export function saveArtifactInspections(inspections: ArtifactInspection[]) {
  const statement = sqlite.prepare(`
    INSERT INTO artifact_inspections (post_id, content_hash, inspection_version, evidence_json, inspected_at)
    VALUES (@postId, @contentHash, @inspectionVersion, @evidenceJson, @inspectedAt)
    ON CONFLICT(post_id, content_hash, inspection_version) DO UPDATE SET
      evidence_json = excluded.evidence_json,
      inspected_at = excluded.inspected_at
  `);
  sqlite.transaction((items: ArtifactInspection[]) => {
    for (const inspection of items) statement.run({
      postId: inspection.postId,
      contentHash: inspection.contentHash,
      inspectionVersion: inspection.inspectionVersion,
      evidenceJson: JSON.stringify(inspection),
      inspectedAt: inspection.inspectedAt,
    });
  })(inspections);
  return inspections.length;
}

export function getCachedInvestigationPacket(post: FeedPost, version = INVESTIGATOR_VERSION) {
  const row = sqlite.prepare(`
    SELECT evidence_json FROM investigation_packets
    WHERE post_id = ? AND content_hash = ? AND investigator_version = ?
  `).get(post.id, feedPostContentHash(post), version) as { evidence_json: string } | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.evidence_json) as InvestigationPacket;
  } catch {
    return null;
  }
}

export function saveInvestigationPackets(packets: InvestigationPacket[]) {
  const statement = sqlite.prepare(`
    INSERT INTO investigation_packets (
      post_id, content_hash, investigator_version, evidence_json, investigated_at
    ) VALUES (@postId, @contentHash, @version, @evidenceJson, @builtAt)
    ON CONFLICT(post_id, content_hash, investigator_version) DO UPDATE SET
      evidence_json = excluded.evidence_json,
      investigated_at = excluded.investigated_at
  `);
  sqlite.transaction((items: InvestigationPacket[]) => {
    for (const packet of items) statement.run({ ...packet, evidenceJson: JSON.stringify(packet) });
  })(packets);
  return packets.length;
}

function rowToInvestigatorVerdict(row: Record<string, unknown>): InvestigatorVerdict {
  return {
    postId: String(row.post_id),
    contentHash: String(row.content_hash),
    version: Number(row.investigator_version),
    model: String(row.model),
    decision: String(row.decision) as InvestigatorDecision,
    sourceRole: String(row.source_role) as InvestigatorSourceRole,
    officialSourceUrl: row.official_source_url == null ? null : String(row.official_source_url),
    canonicalEventKey: String(row.canonical_event_key),
    sourceAuthority: Number(row.source_authority),
    founderCare: Number(row.founder_care),
    productSubstance: Number(row.product_substance),
    marketPotential: Number(row.market_potential),
    differentiation: Number(row.differentiation),
    credibility: Number(row.credibility),
    evidenceConfidence: Number(row.evidence_confidence),
    investorRelevance: Number(row.investor_relevance),
    worthFiveMinutes: Number(row.worth_five_minutes),
    projectKey: row.project_key == null ? null : String(row.project_key),
    projectUrl: row.project_url == null ? null : String(row.project_url),
    description: row.description == null ? null : String(row.description),
    rejectionReason: row.rejection_reason == null ? null : String(row.rejection_reason),
    slopFlags: parseStringArray(row.slop_flags_json),
    evidence: parseStringArray(row.evidence_json),
    inputTokens: Number(row.input_tokens),
    outputTokens: Number(row.output_tokens),
    costMicros: Number(row.cost_micros),
    webSearches: Number(row.web_searches),
    analyzedAt: Number(row.analyzed_at),
  };
}

export function getCachedInvestigatorVerdict(post: FeedPost, version = INVESTIGATOR_VERSION) {
  const row = sqlite.prepare(`
    SELECT * FROM investigator_verdicts
    WHERE post_id = ? AND content_hash = ? AND investigator_version = ?
  `).get(post.id, feedPostContentHash(post), version) as Record<string, unknown> | undefined;
  return row ? rowToInvestigatorVerdict(row) : null;
}

export function saveInvestigatorVerdicts(verdicts: InvestigatorVerdict[]) {
  const statement = sqlite.prepare(`
    INSERT INTO investigator_verdicts (
      post_id, content_hash, investigator_version, model, decision, source_role,
      official_source_url, canonical_event_key, source_authority, founder_care,
      product_substance, market_potential, differentiation, credibility,
      evidence_confidence, investor_relevance, worth_five_minutes, project_key,
      project_url, description, rejection_reason, slop_flags_json, evidence_json,
      input_tokens, output_tokens, cost_micros, web_searches, analyzed_at
    ) VALUES (
      @postId, @contentHash, @version, @model, @decision, @sourceRole,
      @officialSourceUrl, @canonicalEventKey, @sourceAuthority, @founderCare,
      @productSubstance, @marketPotential, @differentiation, @credibility,
      @evidenceConfidence, @investorRelevance, @worthFiveMinutes, @projectKey,
      @projectUrl, @description, @rejectionReason, @slopFlagsJson, @evidenceJson,
      @inputTokens, @outputTokens, @costMicros, @webSearches, @analyzedAt
    )
    ON CONFLICT(post_id, content_hash, investigator_version) DO UPDATE SET
      model = excluded.model,
      decision = excluded.decision,
      source_role = excluded.source_role,
      official_source_url = excluded.official_source_url,
      canonical_event_key = excluded.canonical_event_key,
      source_authority = excluded.source_authority,
      founder_care = excluded.founder_care,
      product_substance = excluded.product_substance,
      market_potential = excluded.market_potential,
      differentiation = excluded.differentiation,
      credibility = excluded.credibility,
      evidence_confidence = excluded.evidence_confidence,
      investor_relevance = excluded.investor_relevance,
      worth_five_minutes = excluded.worth_five_minutes,
      project_key = excluded.project_key,
      project_url = excluded.project_url,
      description = excluded.description,
      rejection_reason = excluded.rejection_reason,
      slop_flags_json = excluded.slop_flags_json,
      evidence_json = excluded.evidence_json,
      input_tokens = excluded.input_tokens,
      output_tokens = excluded.output_tokens,
      cost_micros = excluded.cost_micros,
      web_searches = excluded.web_searches,
      analyzed_at = excluded.analyzed_at
  `);
  sqlite.transaction((items: InvestigatorVerdict[]) => {
    for (const verdict of items) statement.run({
      ...verdict,
      slopFlagsJson: JSON.stringify(verdict.slopFlags),
      evidenceJson: JSON.stringify(verdict.evidence),
    });
  })(verdicts);
  return verdicts.length;
}

export function upsertFeedPosts(posts: FeedPost[], supersededIds: string[] = []) {
  const statement = sqlite.prepare(`
    INSERT INTO x_feed_posts (
      id, category, url, username, display_name, text, published_at,
      likes, reposts, replies, views, media_url, external_urls_json, content_hash, score, fetched_at
    ) VALUES (
      @id, @category, @url, @username, @displayName, @text, @publishedAt,
      @likes, @reposts, @replies, @views, @mediaUrl, @externalUrlsJson, @contentHash, @score, @fetchedAt
    )
    ON CONFLICT(id) DO UPDATE SET
      category = CASE WHEN excluded.score >= x_feed_posts.score THEN excluded.category ELSE x_feed_posts.category END,
      url = excluded.url,
      username = excluded.username,
      display_name = excluded.display_name,
      text = excluded.text,
      published_at = excluded.published_at,
      likes = excluded.likes,
      reposts = excluded.reposts,
      replies = excluded.replies,
      views = excluded.views,
      media_url = excluded.media_url,
      external_urls_json = excluded.external_urls_json,
      content_hash = excluded.content_hash,
      score = MAX(excluded.score, x_feed_posts.score),
      fetched_at = excluded.fetched_at
  `);
  const removeSuperseded = sqlite.prepare("DELETE FROM x_feed_posts WHERE id = ?");
  const save = sqlite.transaction((items: FeedPost[]) => {
    for (const post of items) statement.run({ ...post, externalUrlsJson: JSON.stringify(post.externalUrls), contentHash: feedPostContentHash(post) });
    for (const id of supersededIds) removeSuperseded.run(id);
  });
  save(posts);
  sqlite.prepare("DELETE FROM post_analysis WHERE post_id NOT IN (SELECT id FROM x_feed_posts)").run();
  sqlite.prepare("DELETE FROM artifact_inspections WHERE post_id NOT IN (SELECT id FROM x_feed_posts)").run();
  return posts.length;
}

export function updateFeedPostExternalUrls(postId: string, externalUrls: string[]) {
  sqlite.prepare("UPDATE x_feed_posts SET external_urls_json = ? WHERE id = ?").run(JSON.stringify(externalUrls), postId);
}

const rowToAnalysis = (row: Record<string, unknown>): PostAnalysis => ({
  postId: String(row.post_id),
  contentHash: String(row.content_hash),
  promptVersion: Number(row.prompt_version),
  model: String(row.model),
  keep: Boolean(row.keep),
  signalType: String(row.signal_type),
  relationship: String(row.relationship),
  artifactType: row.artifact_type == null ? null : String(row.artifact_type),
  newArtifact: Boolean(row.new_artifact),
  analystScore: Number(row.analyst_score),
  investorRelevance: Number(row.investor_relevance),
  seoProbability: Number(row.seo_probability),
  confidence: Number(row.confidence),
  projectKey: row.project_key == null ? null : String(row.project_key),
  projectUrl: row.project_url == null ? null : String(row.project_url),
  description: row.description == null ? null : String(row.description),
  rejectionReason: row.rejection_reason == null ? null : String(row.rejection_reason),
  evidence: JSON.parse(String(row.evidence_json)) as string[],
  inputTokens: Number(row.input_tokens),
  outputTokens: Number(row.output_tokens),
  costMicros: Number(row.cost_micros),
  analyzedAt: Number(row.analyzed_at),
});

export function savePostAnalyses(analyses: PostAnalysis[]) {
  const statement = sqlite.prepare(`
    INSERT INTO post_analysis (
      post_id, content_hash, prompt_version, model, keep, signal_type,
      relationship, artifact_type, new_artifact, analyst_score,
      investor_relevance, seo_probability, confidence, project_key,
      project_url, description, rejection_reason, evidence_json, input_tokens, output_tokens,
      cost_micros, analyzed_at
    ) VALUES (
      @postId, @contentHash, @promptVersion, @model, @keep, @signalType,
      @relationship, @artifactType, @newArtifact, @analystScore,
      @investorRelevance, @seoProbability, @confidence, @projectKey,
      @projectUrl, @description, @rejectionReason, @evidenceJson, @inputTokens, @outputTokens,
      @costMicros, @analyzedAt
    )
    ON CONFLICT(post_id, content_hash, prompt_version) DO UPDATE SET
      model = excluded.model,
      keep = excluded.keep,
      signal_type = excluded.signal_type,
      relationship = excluded.relationship,
      artifact_type = excluded.artifact_type,
      new_artifact = excluded.new_artifact,
      analyst_score = excluded.analyst_score,
      investor_relevance = excluded.investor_relevance,
      seo_probability = excluded.seo_probability,
      confidence = excluded.confidence,
      project_key = excluded.project_key,
      project_url = excluded.project_url,
      description = excluded.description,
      rejection_reason = excluded.rejection_reason,
      evidence_json = excluded.evidence_json,
      input_tokens = excluded.input_tokens,
      output_tokens = excluded.output_tokens,
      cost_micros = excluded.cost_micros,
      analyzed_at = excluded.analyzed_at
  `);
  sqlite.transaction((items: PostAnalysis[]) => {
    for (const analysis of items) statement.run({
      ...analysis,
      keep: Number(analysis.keep),
      newArtifact: Number(analysis.newArtifact),
      evidenceJson: JSON.stringify(analysis.evidence),
    });
  })(analyses);
  return analyses.length;
}

export function analysisStatsForDay(day: string) {
  const start = Date.parse(`${day}T00:00:00.000Z`);
  return sqlite.prepare(`
    SELECT
      COUNT(*) analyzed,
      SUM(keep) accepted,
      SUM(cost_micros) cost_micros,
      SUM(input_tokens) input_tokens,
      SUM(output_tokens) output_tokens
    FROM post_analysis a
    JOIN x_feed_posts p ON p.id = a.post_id AND p.content_hash = a.content_hash
    WHERE a.prompt_version = ? AND p.published_at >= ? AND p.published_at < ?
  `).get(ANALYSIS_VERSION, start, start + 86_400_000) as {
    analyzed: number; accepted: number | null; cost_micros: number | null; input_tokens: number | null; output_tokens: number | null;
  };
}

export function listProjectRows(from: string, to: string, limit = 5000, scope: "curated" | "all" = "curated"): ProjectRow[] {
  const start = Date.parse(`${from}T00:00:00.000Z`);
  const inclusiveEnd = Date.parse(`${to}T00:00:00.000Z`);
  const includeAll = scope === "all" ? 1 : 0;
  if (!Number.isFinite(start) || !Number.isFinite(inclusiveEnd) || start > inclusiveEnd) throw new Error("Invalid project date range");
  const rows = sqlite.prepare(`
    WITH investigator_days AS (
      SELECT scan_day
      FROM x_feed_scans
      WHERE status = 'completed'
        AND investigator_version = ?
        AND scan_day IS NOT NULL
      GROUP BY scan_day
    ), effective AS (
      SELECT
        p.*,
        CASE
          WHEN d.scan_day IS NOT NULL AND v.post_id IS NOT NULL THEN v.investigator_version
          ELSE a.prompt_version
        END AS prompt_version,
        CASE
          WHEN d.scan_day IS NOT NULL AND v.post_id IS NOT NULL THEN v.model
          ELSE a.model
        END AS model,
        CASE
          WHEN d.scan_day IS NOT NULL THEN CASE WHEN v.decision = 'publish' THEN 1 ELSE 0 END
          ELSE a.keep
        END AS keep,
        a.signal_type,
        CASE
          WHEN d.scan_day IS NOT NULL AND v.post_id IS NOT NULL THEN v.source_role
          ELSE a.relationship
        END AS relationship,
        a.artifact_type,
        a.new_artifact,
        CASE
          WHEN d.scan_day IS NOT NULL AND v.post_id IS NOT NULL THEN COALESCE(NULLIF(v.project_key, ''), a.project_key)
          ELSE a.project_key
        END AS project_key,
        CASE
          WHEN d.scan_day IS NOT NULL AND v.post_id IS NOT NULL THEN COALESCE(NULLIF(v.project_url, ''), a.project_url)
          ELSE a.project_url
        END AS project_url,
        CASE
          WHEN d.scan_day IS NOT NULL AND v.post_id IS NOT NULL THEN COALESCE(NULLIF(v.description, ''), a.description)
          ELSE a.description
        END AS description,
        CASE
          WHEN d.scan_day IS NOT NULL AND v.post_id IS NOT NULL THEN v.worth_five_minutes
          ELSE a.analyst_score
        END AS analyst_score,
        CASE
          WHEN d.scan_day IS NOT NULL AND v.post_id IS NOT NULL THEN v.investor_relevance
          ELSE a.investor_relevance
        END AS investor_relevance,
        a.seo_probability,
        CASE
          WHEN d.scan_day IS NOT NULL AND v.post_id IS NOT NULL THEN v.evidence_confidence
          ELSE a.confidence
        END AS confidence,
        CASE
          WHEN d.scan_day IS NOT NULL AND v.post_id IS NOT NULL THEN v.rejection_reason
          ELSE a.rejection_reason
        END AS rejection_reason,
        CASE
          WHEN d.scan_day IS NOT NULL AND v.post_id IS NOT NULL THEN v.evidence_json
          ELSE a.evidence_json
        END AS evidence_json,
        CASE
          WHEN d.scan_day IS NOT NULL AND v.post_id IS NOT NULL THEN a.input_tokens + v.input_tokens
          ELSE a.input_tokens
        END AS input_tokens,
        CASE
          WHEN d.scan_day IS NOT NULL AND v.post_id IS NOT NULL THEN a.output_tokens + v.output_tokens
          ELSE a.output_tokens
        END AS output_tokens,
        CASE
          WHEN d.scan_day IS NOT NULL AND v.post_id IS NOT NULL THEN a.cost_micros + v.cost_micros
          ELSE a.cost_micros
        END AS cost_micros,
        CASE
          WHEN d.scan_day IS NOT NULL AND v.post_id IS NOT NULL THEN MAX(a.analyzed_at, v.analyzed_at)
          ELSE a.analyzed_at
        END AS analyzed_at,
        CASE
          WHEN d.scan_day IS NOT NULL AND v.post_id IS NOT NULL THEN NULLIF(v.canonical_event_key, '')
          ELSE NULL
        END AS canonical_event_key
      FROM x_feed_posts p
      JOIN post_analysis a
        ON a.post_id = p.id
        AND a.content_hash = p.content_hash
        AND a.prompt_version = ?
      LEFT JOIN investigator_days d
        ON d.scan_day = date(p.published_at / 1000, 'unixepoch')
      LEFT JOIN investigator_verdicts v
        ON v.post_id = p.id
        AND v.content_hash = p.content_hash
        AND v.investigator_version = ?
      WHERE p.published_at >= ? AND p.published_at < ?
    ), ranked AS (
      SELECT
        effective.*,
        ROW_NUMBER() OVER (
          PARTITION BY lower(COALESCE(NULLIF(project_url, ''), NULLIF(project_key, ''), canonical_event_key, id))
          ORDER BY analyst_score DESC, score DESC, published_at ASC
        ) AS project_rank
      FROM effective
      WHERE (? = 1 OR keep = 1)
    )
    SELECT * FROM ranked
    WHERE (? = 1 OR project_rank = 1)
    ORDER BY published_at DESC, analyst_score DESC
    LIMIT ?
  `).all(
    INVESTIGATOR_VERSION,
    ANALYSIS_VERSION,
    INVESTIGATOR_VERSION,
    start,
    inclusiveEnd + 86_400_000,
    includeAll,
    includeAll,
    limit,
  ) as Array<Record<string, unknown>>;
  return rows.map((row) => {
    const externalUrls = parseStringArray(row.external_urls_json);
    return {
      postId: String(row.id),
      date: Number(row.published_at),
      category: row.category as FeedCategory,
      builderName: row.display_name == null ? String(row.username) : String(row.display_name),
      username: String(row.username),
      projectName: row.project_key == null ? "—" : String(row.project_key),
      projectUrl: row.project_url == null ? (externalUrls[0] ?? null) : String(row.project_url),
      description: row.description == null ? null : String(row.description),
      discoveryUrl: String(row.url),
      postText: String(row.text),
      mediaUrl: row.media_url == null ? null : String(row.media_url),
      externalUrls,
      likes: Number(row.likes),
      reposts: Number(row.reposts),
      replies: Number(row.replies),
      views: Number(row.views),
      discoveryScore: Number(row.score),
      fetchedAt: Number(row.fetched_at),
      contentHash: String(row.content_hash),
      promptVersion: Number(row.prompt_version),
      model: String(row.model),
      keep: Boolean(row.keep),
      signalType: String(row.signal_type),
      relationship: String(row.relationship),
      artifactType: row.artifact_type == null ? null : String(row.artifact_type),
      newArtifact: Boolean(row.new_artifact),
      analystScore: Number(row.analyst_score),
      investorRelevance: Number(row.investor_relevance),
      seoProbability: Number(row.seo_probability),
      confidence: Number(row.confidence),
      rejectionReason: row.rejection_reason == null ? null : String(row.rejection_reason),
      evidence: parseStringArray(row.evidence_json),
      inputTokens: Number(row.input_tokens),
      outputTokens: Number(row.output_tokens),
      costMicros: Number(row.cost_micros),
      analyzedAt: Number(row.analyzed_at),
    };
  }).filter((row) => !isCryptoPromotionText(row.postText));
}

export function startFeedScan(scanDay?: string, investigatorVersion: number | null = INVESTIGATOR_VERSION) {
  const result = sqlite.prepare("INSERT INTO x_feed_scans (status, started_at, scan_day, analysis_version, investigator_version) VALUES ('running', ?, ?, ?, ?)")
    .run(Date.now(), scanDay ?? null, ANALYSIS_VERSION, investigatorVersion);
  return Number(result.lastInsertRowid);
}

export function completedBackfillDays(from: string, to: string) {
  return new Set((sqlite.prepare(`
    SELECT DISTINCT scan_day FROM x_feed_scans
    WHERE status = 'completed' AND analysis_version = ? AND scan_day >= ? AND scan_day <= ?
  `).all(ANALYSIS_VERSION, from, to) as Array<{ scan_day: string }>).map((row) => row.scan_day));
}

export function recentCompletedScanDays(limit = 3) {
  return (sqlite.prepare(`
    SELECT scan_day
    FROM x_feed_scans
    WHERE status = 'completed' AND analysis_version = ? AND scan_day IS NOT NULL
    GROUP BY scan_day
    ORDER BY scan_day DESC
    LIMIT ?
  `).all(ANALYSIS_VERSION, Math.max(1, Math.min(30, limit))) as Array<{ scan_day: string }>)
    .map((row) => row.scan_day);
}

export function finishFeedScan(id: number, input: { status: "completed" | "failed"; foundCount?: number; savedCount?: number; error?: string | null }) {
  sqlite.prepare(`UPDATE x_feed_scans SET status = ?, completed_at = ?, found_count = ?, saved_count = ?, error = ? WHERE id = ?`)
    .run(input.status, Date.now(), input.foundCount ?? 0, input.savedCount ?? 0, input.error ?? null, id);
}

export function latestFeedScan(): FeedScan | null {
  const row = sqlite.prepare("SELECT * FROM x_feed_scans ORDER BY id DESC LIMIT 1").get() as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    id: Number(row.id),
    status: row.status as FeedScan["status"],
    startedAt: Number(row.started_at),
    completedAt: row.completed_at == null ? null : Number(row.completed_at),
    foundCount: Number(row.found_count),
    savedCount: Number(row.saved_count),
    scanDay: row.scan_day == null ? null : String(row.scan_day),
    analysisVersion: row.analysis_version == null ? null : Number(row.analysis_version),
    investigatorVersion: row.investigator_version == null ? null : Number(row.investigator_version),
    error: row.error == null ? null : String(row.error),
  };
}
