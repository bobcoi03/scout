import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type {
  ArtifactInspection,
  FeedPost,
  InvestigationPacket,
  InvestigatorMediaEvidence,
  InvestigatorProfileEvidence,
  InvestigatorRepositoryEvidence,
  InvestigatorSiteEvidence,
  PostAnalysis,
} from "@/db";
import {
  INVESTIGATOR_VERSION,
  feedPostContentHash,
  getCachedInvestigationPacket,
  saveInvestigationPackets,
} from "@/db";
import { artifactPromptEvidence, assertPublicHttpUrl } from "@/lib/artifact-inspector";
import { env, xSessionConfigured } from "@/lib/env";
import { getXPostById, getXProfile, getXRecentPosts } from "@/lib/x-session";

const execFileAsync = promisify(execFile);
const maxHtmlBytes = 1_500_000;
const maxMediaBytes = 40_000_000;
const temporaryHostPattern = /(?:^|\.)(?:vercel\.app|netlify\.app|pages\.dev|web\.app|github\.io|glitch\.me|replit\.app|lovable\.app|framer\.website)$/i;
const firstPartyPattern = /\b(?:(?:i|we)(?:['’](?:ve|re|m)| (?:have|are|am))?\s+(?:just\s+)?(?:built|made|created|launched|released|shipped|open[ -]?sourced|founded|started|building)|(?:my|our)\s+(?:team\s+)?(?:built|made|created|launched|released|shipped|open[ -]?sourced|founded|startup|company|product)|(?:built|made|created|launched|released|shipped)\s+by\s+(?:me|us))\b/i;
const commentaryPattern = /\b(?:i(?:'ve| have) (?:seen|tracked|found|used)|the best .* i(?:'ve| have) seen|worth (?:watching|checking)|looks (?:promising|interesting)|someone (?:built|launched)|this (?:project|product|tool|repo))\b/i;
const infrastructureClaimPattern = /\b(?:distributed|infrastructure|runtime|engine|compiler|database|platform|pytorch|vulkan|directx|dx12|webgpu|kernel|streaming|caching|large (?:ai )?model|consumer hardware)\b/i;
const concreteFreshLaunchPattern = /\b(?:(?:just\s+)?(?:launch(?:ed|ing)?|releas(?:ed|ing)?|announc(?:ed|ing)?|introduc(?:ed|ing)?|open[ -]?sourced|shipp(?:ed|ing))|now live|available today|new (?:release|version|product|feature|api|model|app)|version \d|v\d+(?:\.\d+)+)\b/i;
const placeholderPatterns = [
  /\bcoming soon\b/i,
  /\bunder construction\b/i,
  /\blorem ipsum\b/i,
  /\b(?:todo|tbd)\b/i,
  /\bexample\.com\b/i,
  /\btemplate by\b/i,
];
const sourceFilePattern = /\.(?:[cm]?[jt]sx?|py|rs|go|java|kt|swift|rb|php|cs|cpp|cc|cxx|c|h|hpp|sol|vue|svelte)$/i;
const testFilePattern = /(?:^|\/)(?:test|tests|spec|specs|__tests__)(?:\/|$)|(?:\.test|\.spec)\.[^.]+$/i;
const documentationPattern = /(?:^|\/)(?:docs?|documentation)(?:\/|$)|(?:^|\/)(?:readme|contributing|architecture|design)(?:\.[^/]+)?$/i;
const ciPattern = /(?:^|\/)(?:\.github\/workflows|\.circleci|\.gitlab-ci|buildkite|jenkinsfile)(?:\/|$)/i;
const excludedSamplePattern = /(?:^|\/)(?:node_modules|vendor|dist|build|coverage|fixtures?|snapshots?)(?:\/|$)|(?:\.min\.|\.lock$|package-lock\.json$|pnpm-lock\.yaml$|yarn\.lock$|\.env|secret|credential|private[_-]?key)/i;
const profileCache = new Map<string, Promise<InvestigatorProfileEvidence>>();
const siteCache = new Map<string, Promise<InvestigatorSiteEvidence>>();
const repositoryCache = new Map<string, Promise<InvestigatorRepositoryEvidence>>();

export function isFirstPartyBuilderText(text: string) {
  return firstPartyPattern.test(text);
}

function cleanText(value: string, max = 1_000) {
  return value.replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"").replace(/&#39;|&apos;/gi, "'").replace(/\s+/g, " ").trim().slice(0, max);
}

function normalizedName(value: string | null | undefined) {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function comparableHost(value: string | null | undefined) {
  try {
    return new URL(value ?? "").hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function safeUrl(value: string, base?: string) {
  try {
    const url = new URL(value, base);
    if (!/^https?:$/.test(url.protocol)) return null;
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:utm_|ref$|ref_|source$|s$)/i.test(key)) url.searchParams.delete(key);
    }
    return url.href;
  } catch {
    return null;
  }
}

async function readLimitedResponse(response: Response, limit: number) {
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < limit) {
    const { done, value } = await reader.read();
    if (done) break;
    const remaining = limit - size;
    chunks.push(value.length > remaining ? value.slice(0, remaining) : value);
    size += Math.min(value.length, remaining);
    if (value.length > remaining) await reader.cancel();
  }
  return Buffer.concat(chunks);
}

async function fetchPublic(value: string, limit = maxHtmlBytes) {
  let current = (await assertPublicHttpUrl(value)).href;
  for (let redirects = 0; redirects <= 4; redirects += 1) {
    const response = await fetch(current, {
      redirect: "manual",
      headers: { "User-Agent": "ScoutInvestigator/1.0 (+local product discovery)" },
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return { response, finalUrl: current, body: new Uint8Array() };
      current = (await assertPublicHttpUrl(new URL(location, current).href)).href;
      continue;
    }
    return { response, finalUrl: current, body: await readLimitedResponse(response, limit) };
  }
  throw new Error("Too many redirects");
}

function extractLinks(html: string, base: string) {
  const links: Array<{ url: string; label: string }> = [];
  const seen = new Set<string>();
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const url = safeUrl(match[1], base);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    links.push({ url, label: cleanText(match[2], 120) });
    if (links.length >= 150) break;
  }
  return links;
}

function extractCtas(html: string) {
  const labels = new Set<string>();
  for (const match of html.matchAll(/<(?:button|a)\b[^>]*>([\s\S]*?)<\/(?:button|a)>/gi)) {
    const label = cleanText(match[1], 80);
    if (label && /\b(?:try|start|get|open|launch|demo|sign|join|download|install|build|explore|use|play|book)\b/i.test(label)) labels.add(label);
    if (labels.size >= 20) break;
  }
  return [...labels];
}

export function analyzeSiteHtml(url: string, html: string, title: string | null, description: string | null): Omit<InvestigatorSiteEvidence, "screenshotPath" | "unavailableReason"> {
  const host = comparableHost(url) ?? "";
  const links = extractLinks(html, url);
  const internal = links.filter((link) => comparableHost(link.url) === host);
  const external = links.filter((link) => comparableHost(link.url) !== host);
  const notableLinks = links
    .filter((link) => /github\.com|\/(?:docs?|documentation|pricing|download|install|demo|app|login|signup|waitlist)(?:\/|$|\?)/i.test(link.url)
      || /\b(?:github|docs?|pricing|download|install|demo|open app|try|sign up|join waitlist)\b/i.test(link.label))
    .map((link) => link.url)
    .slice(0, 30);
  const signalText = cleanText(html, 20_000);
  const placeholderSignals = placeholderPatterns
    .filter((pattern) => pattern.test(signalText))
    .map((pattern) => pattern.source.replace(/\\b|\(\?:|\)|\\|[\[\]?+*^$]/g, " ").replace(/\s+/g, " ").trim())
    .slice(0, 5);
  return {
    url,
    host,
    title,
    description,
    textSample: signalText.slice(0, 5_000),
    temporaryHost: temporaryHostPattern.test(host),
    htmlBytes: Buffer.byteLength(html),
    internalLinkCount: internal.length,
    externalLinkCount: external.length,
    notableLinks,
    ctaLabels: extractCtas(html),
    imageCount: [...html.matchAll(/<img\b/gi)].length,
    videoCount: [...html.matchAll(/<(?:video|iframe)\b/gi)].length,
    hasDocs: links.some((link) => /\/docs?(?:\/|$|\?)/i.test(link.url) || /\bdocs?|documentation\b/i.test(link.label)),
    hasPricing: links.some((link) => /\/pricing(?:\/|$|\?)/i.test(link.url) || /\bpricing\b/i.test(link.label)),
    hasWorkingProductLink: links.some((link) => /\/(?:app|demo|login|signup|download|install|play)(?:\/|$|\?)/i.test(link.url)
      || /\b(?:open app|try it|live demo|download|install|play now|get started)\b/i.test(link.label)),
    placeholderSignals,
  };
}

async function inspectSite(value: string): Promise<InvestigatorSiteEvidence> {
  try {
    const { response, finalUrl, body } = await fetchPublic(value);
    const html = new TextDecoder().decode(body);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const title = cleanText(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "", 300) || null;
    const description = cleanText(/<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]+content=["']([^"']*)["']/i.exec(html)?.[1] ?? "", 500) || null;
    return {
      ...analyzeSiteHtml(finalUrl, html, title, description),
      screenshotPath: null,
      unavailableReason: null,
    };
  } catch (error) {
    const host = comparableHost(value) ?? "";
    return {
      url: value,
      host,
      title: null,
      description: null,
      textSample: "",
      temporaryHost: temporaryHostPattern.test(host),
      htmlBytes: 0,
      internalLinkCount: 0,
      externalLinkCount: 0,
      notableLinks: [],
      ctaLabels: [],
      imageCount: 0,
      videoCount: 0,
      hasDocs: false,
      hasPricing: false,
      hasWorkingProductLink: false,
      placeholderSignals: [],
      screenshotPath: null,
      unavailableReason: error instanceof Error ? error.message.slice(0, 300) : String(error),
    };
  }
}

function cachedSite(value: string) {
  const key = safeUrl(value) ?? value;
  const existing = siteCache.get(key);
  if (existing) return existing;
  const pending = inspectSite(key);
  siteCache.set(key, pending);
  return pending;
}

async function profileEvidence(post: FeedPost): Promise<InvestigatorProfileEvidence> {
  if (!xSessionConfigured()) {
    return {
      username: post.username, name: post.displayName, biography: null, website: null,
      joinedAt: null, accountAgeDays: null, followers: null, following: null, posts: null,
      listed: null, verified: false, recentPosts: [], unavailableReason: "X session is not configured",
    };
  }
  try {
    const [profile, recentPosts] = await Promise.all([
      getXProfile(post.username),
      getXRecentPosts(post.username, 10).catch(() => []),
    ]);
    const joinedAt = profile.joined?.toISOString() ?? null;
    return {
      username: post.username,
      name: profile.name ?? post.displayName,
      biography: profile.biography?.replace(/\s+/g, " ").trim().slice(0, 500) ?? null,
      website: profile.website ?? null,
      joinedAt,
      accountAgeDays: joinedAt ? Math.max(0, Math.round((Date.now() - Date.parse(joinedAt)) / 86_400_000)) : null,
      followers: profile.followersCount ?? null,
      following: profile.followingCount ?? profile.friendsCount ?? null,
      posts: profile.statusesCount ?? profile.tweetsCount ?? null,
      listed: profile.listedCount ?? null,
      verified: Boolean(profile.isVerified || profile.isBlueVerified),
      recentPosts,
      unavailableReason: null,
    };
  } catch (error) {
    return {
      username: post.username, name: post.displayName, biography: null, website: null,
      joinedAt: null, accountAgeDays: null, followers: null, following: null, posts: null,
      listed: null, verified: false, recentPosts: [],
      unavailableReason: error instanceof Error ? error.message.slice(0, 300) : String(error),
    };
  }
}

function cachedProfile(post: FeedPost) {
  const key = post.username.toLowerCase();
  const existing = profileCache.get(key);
  if (existing) return existing;
  const pending = profileEvidence(post);
  profileCache.set(key, pending);
  return pending;
}

function githubRepository(value: string) {
  try {
    const url = new URL(value);
    if (url.hostname.toLowerCase() !== "github.com") return null;
    const [owner, repo] = url.pathname.split("/").filter(Boolean);
    if (!owner || !repo || ["features", "topics", "marketplace", "orgs"].includes(owner.toLowerCase())) return null;
    return { owner, repo: repo.replace(/\.git$/i, ""), fullName: `${owner}/${repo.replace(/\.git$/i, "")}` };
  } catch {
    return null;
  }
}

async function githubJson(url: string) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "ScoutInvestigator/1.0",
      ...(env.githubToken ? { Authorization: `Bearer ${env.githubToken}` } : {}),
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`GitHub API ${response.status}`);
  return response.json() as Promise<unknown>;
}

function selectRepresentativePaths(paths: string[]) {
  const manifests = paths.filter((item) => /(?:^|\/)(?:package\.json|pyproject\.toml|cargo\.toml|go\.mod|requirements\.txt|composer\.json|gemfile)$/i.test(item));
  const code = paths.filter((item) => sourceFilePattern.test(item) && !testFilePattern.test(item) && !excludedSamplePattern.test(item));
  const scored = code.sort((a, b) => {
    const aScore = /\b(?:src|app|lib|server|core)\b/i.test(a) ? 1 : 0;
    const bScore = /\b(?:src|app|lib|server|core)\b/i.test(b) ? 1 : 0;
    return bScore - aScore || a.length - b.length;
  });
  return [...new Set([...manifests.slice(0, 2), ...scored.slice(0, 4)])].slice(0, 6);
}

type ArchiveStructure = {
  branch: string;
  files: string[];
  representativeFiles: Array<{ path: string; excerpt: string }>;
};

async function repositoryArchiveStructure(owner: string, repo: string, branches: string[]): Promise<ArchiveStructure> {
  const directory = path.resolve(process.cwd(), "data", "investigator-repos");
  await fs.mkdir(directory, { recursive: true });
  const digest = createHash("sha256").update(`${owner}/${repo}`).digest("hex").slice(0, 16);
  const archivePath = path.join(directory, `${digest}.tar.gz`);
  let selectedBranch = "";
  try {
    for (const branch of [...new Set([...branches, "main", "master"])]) {
      const response = await fetch(`https://codeload.github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/tar.gz/refs/heads/${encodeURIComponent(branch)}`, {
        headers: { "User-Agent": "ScoutInvestigator/1.0" },
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) continue;
      const body = await readLimitedResponse(response, 25_000_000);
      if (!body.length || body.length >= 25_000_000) throw new Error("Repository archive is empty or exceeds the 25 MB review limit");
      await fs.writeFile(archivePath, body);
      selectedBranch = branch;
      break;
    }
    if (!selectedBranch) throw new Error("No main or master repository archive was available");
    const listing = await execFileAsync("tar", ["-tzf", archivePath], { timeout: 30_000, maxBuffer: 12_000_000 });
    const archiveFiles = listing.stdout.split("\n").filter((item) => item && !item.endsWith("/"));
    const rootPrefix = archiveFiles[0]?.split("/")[0] ?? "";
    const files = archiveFiles.map((item) => item.startsWith(`${rootPrefix}/`) ? item.slice(rootPrefix.length + 1) : item).filter(Boolean);
    const representativePaths = selectRepresentativePaths(files);
    const representativeFiles: Array<{ path: string; excerpt: string }> = [];
    for (const filePath of representativePaths) {
      const archiveEntry = `${rootPrefix}/${filePath}`;
      try {
        const result = await execFileAsync("tar", ["-xOzf", archivePath, archiveEntry], { timeout: 10_000, maxBuffer: 30_000 });
        const excerpt = cleanText(result.stdout, 2_000);
        if (excerpt) representativeFiles.push({ path: filePath, excerpt });
      } catch {
        // A file sample is optional; the complete archive tree still establishes substance.
      }
    }
    return { branch: selectedBranch, files, representativeFiles };
  } finally {
    await fs.unlink(archivePath).catch(() => undefined);
  }
}

function inferredPrimaryLanguage(files: string[]) {
  const counts = new Map<string, number>();
  const names: Record<string, string> = {
    ts: "TypeScript", tsx: "TypeScript", js: "JavaScript", jsx: "JavaScript", py: "Python",
    rs: "Rust", go: "Go", java: "Java", kt: "Kotlin", swift: "Swift", rb: "Ruby",
    php: "PHP", cs: "C#", cpp: "C++", cc: "C++", cxx: "C++", c: "C", sol: "Solidity",
    vue: "Vue", svelte: "Svelte",
  };
  for (const file of files) {
    const extension = file.split(".").pop()?.toLowerCase() ?? "";
    const name = names[extension];
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

async function archiveRepositoryEvidence(value: string, repository: { owner: string; repo: string; fullName: string }, metadata: Record<string, unknown> = {}): Promise<InvestigatorRepositoryEvidence> {
  try {
    const defaultBranch = typeof metadata.default_branch === "string" ? metadata.default_branch : "main";
    const structure = await repositoryArchiveStructure(repository.owner, repository.repo, [defaultBranch]);
    const files = structure.files;
    return {
      url: `https://github.com/${repository.fullName}`,
      fullName: String(metadata.full_name ?? repository.fullName),
      description: typeof metadata.description === "string" ? metadata.description : null,
      createdAt: typeof metadata.created_at === "string" ? metadata.created_at : null,
      updatedAt: typeof metadata.updated_at === "string" ? metadata.updated_at : null,
      pushedAt: typeof metadata.pushed_at === "string" ? metadata.pushed_at : null,
      defaultBranch: structure.branch,
      stars: Number(metadata.stargazers_count ?? 0),
      forks: Number(metadata.forks_count ?? 0),
      watchers: Number(metadata.subscribers_count ?? metadata.watchers_count ?? 0),
      openIssues: Number(metadata.open_issues_count ?? 0),
      sizeKb: Number(metadata.size ?? 0),
      primaryLanguage: typeof metadata.language === "string" ? metadata.language : inferredPrimaryLanguage(files),
      license: metadata.license && typeof metadata.license === "object" && typeof (metadata.license as Record<string, unknown>).spdx_id === "string"
        ? String((metadata.license as Record<string, unknown>).spdx_id)
        : null,
      archived: Boolean(metadata.archived),
      fork: Boolean(metadata.fork),
      topics: Array.isArray(metadata.topics) ? metadata.topics.filter((item): item is string => typeof item === "string").slice(0, 20) : [],
      languages: {},
      contributors: null,
      totalFiles: files.length || null,
      sourceFiles: files.length ? files.filter((item) => sourceFilePattern.test(item) && !excludedSamplePattern.test(item)).length : null,
      testFiles: files.length ? files.filter((item) => testFilePattern.test(item)).length : null,
      documentationFiles: files.length ? files.filter((item) => documentationPattern.test(item)).length : null,
      hasCi: files.length ? files.some((item) => ciPattern.test(item)) : null,
      rootFiles: files.filter((item) => !item.includes("/")).slice(0, 40),
      representativeFiles: structure.representativeFiles,
      unavailableReason: null,
    };
  } catch (error) {
    return {
      url: value,
      fullName: repository.fullName,
      description: typeof metadata.description === "string" ? metadata.description : null,
      createdAt: typeof metadata.created_at === "string" ? metadata.created_at : null,
      updatedAt: typeof metadata.updated_at === "string" ? metadata.updated_at : null,
      pushedAt: typeof metadata.pushed_at === "string" ? metadata.pushed_at : null,
      defaultBranch: typeof metadata.default_branch === "string" ? metadata.default_branch : null,
      stars: Number(metadata.stargazers_count ?? 0), forks: Number(metadata.forks_count ?? 0),
      watchers: Number(metadata.watchers_count ?? 0), openIssues: Number(metadata.open_issues_count ?? 0),
      sizeKb: Number(metadata.size ?? 0), primaryLanguage: typeof metadata.language === "string" ? metadata.language : null,
      license: null, archived: Boolean(metadata.archived), fork: Boolean(metadata.fork), topics: [], languages: {}, contributors: null,
      totalFiles: null, sourceFiles: null, testFiles: null, documentationFiles: null,
      hasCi: null, rootFiles: [], representativeFiles: [],
      unavailableReason: error instanceof Error ? error.message.slice(0, 300) : String(error),
    };
  }
}

async function rawGithubExcerpt(owner: string, repo: string, branch: string, filePath: string) {
  try {
    const response = await fetch(`https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(branch)}/${filePath.split("/").map(encodeURIComponent).join("/")}`, {
      headers: { "User-Agent": "ScoutInvestigator/1.0" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;
    const value = new TextDecoder().decode(await readLimitedResponse(response, 12_000));
    if (value.includes("\u0000")) return null;
    return cleanText(value, 2_000);
  } catch {
    return null;
  }
}

async function inspectRepository(value: string): Promise<InvestigatorRepositoryEvidence> {
  const repository = githubRepository(value);
  if (!repository) throw new Error("Not a GitHub repository URL");
  const apiRoot = `https://api.github.com/repos/${repository.fullName}`;
  try {
    const metadata = await githubJson(apiRoot) as Record<string, unknown>;
    const defaultBranch = typeof metadata.default_branch === "string" ? metadata.default_branch : "main";
    const [languagesResult, contributorsResult, treeResult] = await Promise.allSettled([
      githubJson(`${apiRoot}/languages`),
      githubJson(`${apiRoot}/contributors?per_page=100&anon=1`),
      githubJson(`${apiRoot}/git/trees/${encodeURIComponent(defaultBranch)}?recursive=1`),
    ]);
    const languages = languagesResult.status === "fulfilled" && languagesResult.value && typeof languagesResult.value === "object"
      ? languagesResult.value as Record<string, number>
      : {};
    const contributors = contributorsResult.status === "fulfilled" && Array.isArray(contributorsResult.value)
      ? contributorsResult.value.length
      : null;
    const tree = treeResult.status === "fulfilled" && treeResult.value && typeof treeResult.value === "object"
      ? (treeResult.value as { tree?: Array<{ path?: string; type?: string }> }).tree ?? []
      : [];
    let files = tree.filter((item) => item.type === "blob" && item.path).map((item) => item.path!);
    let archiveSamples: Array<{ path: string; excerpt: string }> = [];
    if (!files.length) {
      const archive = await archiveRepositoryEvidence(value, repository, metadata);
      files = archive.totalFiles ? [
        ...archive.rootFiles,
        ...archive.representativeFiles.map((item) => item.path),
      ] : [];
      if (archive.totalFiles) {
        return {
          ...archive,
          languages,
          contributors,
          unavailableReason: archive.unavailableReason,
        };
      }
      archiveSamples = archive.representativeFiles;
    }
    const representativePaths = selectRepresentativePaths(files);
    const excerpts = await Promise.all(representativePaths.map(async (filePath) => {
      const excerpt = await rawGithubExcerpt(repository.owner, repository.repo, defaultBranch, filePath);
      return excerpt ? { path: filePath, excerpt } : null;
    }));
    return {
      url: `https://github.com/${repository.fullName}`,
      fullName: String(metadata.full_name ?? repository.fullName),
      description: typeof metadata.description === "string" ? metadata.description : null,
      createdAt: typeof metadata.created_at === "string" ? metadata.created_at : null,
      updatedAt: typeof metadata.updated_at === "string" ? metadata.updated_at : null,
      pushedAt: typeof metadata.pushed_at === "string" ? metadata.pushed_at : null,
      defaultBranch,
      stars: Number(metadata.stargazers_count ?? 0),
      forks: Number(metadata.forks_count ?? 0),
      watchers: Number(metadata.subscribers_count ?? metadata.watchers_count ?? 0),
      openIssues: Number(metadata.open_issues_count ?? 0),
      sizeKb: Number(metadata.size ?? 0),
      primaryLanguage: typeof metadata.language === "string" ? metadata.language : null,
      license: metadata.license && typeof metadata.license === "object" && typeof (metadata.license as Record<string, unknown>).spdx_id === "string"
        ? String((metadata.license as Record<string, unknown>).spdx_id)
        : null,
      archived: Boolean(metadata.archived),
      fork: Boolean(metadata.fork),
      topics: Array.isArray(metadata.topics) ? metadata.topics.filter((item): item is string => typeof item === "string").slice(0, 20) : [],
      languages,
      contributors,
      totalFiles: files.length || null,
      sourceFiles: files.length ? files.filter((item) => sourceFilePattern.test(item) && !excludedSamplePattern.test(item)).length : null,
      testFiles: files.length ? files.filter((item) => testFilePattern.test(item)).length : null,
      documentationFiles: files.length ? files.filter((item) => documentationPattern.test(item)).length : null,
      hasCi: files.length ? files.some((item) => ciPattern.test(item)) : null,
      rootFiles: files.filter((item) => !item.includes("/")).slice(0, 40),
      representativeFiles: excerpts.filter((item): item is { path: string; excerpt: string } => Boolean(item)).length
        ? excerpts.filter((item): item is { path: string; excerpt: string } => Boolean(item))
        : archiveSamples,
      unavailableReason: null,
    };
  } catch {
    return archiveRepositoryEvidence(value, repository);
  }
}

function cachedRepository(value: string) {
  const repository = githubRepository(value);
  const key = repository?.fullName.toLowerCase() ?? value;
  const existing = repositoryCache.get(key);
  if (existing) return existing;
  const pending = inspectRepository(value);
  repositoryCache.set(key, pending);
  return pending;
}

function sourceRoleHint(post: FeedPost, prior: PostAnalysis | null, profile: InvestigatorProfileEvidence, sites: InvestigatorSiteEvidence[]) {
  const project = normalizedName(prior?.projectKey);
  const identity = normalizedName(`${post.username} ${post.displayName ?? ""} ${profile.name ?? ""}`);
  const profileHost = comparableHost(profile.website);
  const siteHosts = new Set(sites.map((site) => site.host));
  if ((project.length >= 4 && identity.includes(project)) || (profileHost && siteHosts.has(profileHost))) {
    return { role: "official" as const, reason: "The posting identity matches the project name or linked product domain." };
  }
  if (isFirstPartyBuilderText(post.text)) {
    return { role: "creator" as const, reason: "The post uses first-party builder language or was previously classified as the creator." };
  }
  if (prior?.relationship === "team_member") {
    return { role: "team_member" as const, reason: "The existing analysis identifies the author as a team member." };
  }
  if (prior?.relationship === "commentator" || prior?.relationship === "curator" || commentaryPattern.test(post.text)) {
    return { role: "commentary" as const, reason: "The author appears to be commenting on or curating another team's work." };
  }
  return { role: "unknown" as const, reason: "The available identity evidence does not establish a connection to the product." };
}

export function hasThinClaimArtifactMismatch(post: FeedPost, packet: InvestigationPacket) {
  return packet.repositories.some((repository) => {
    if (repository.unavailableReason || repository.totalFiles == null || repository.sourceFiles == null) return false;
    const languageBytes = Object.values(repository.languages).reduce((sum, bytes) => sum + Number(bytes || 0), 0);
    const marketingBytes = Number(repository.languages.HTML ?? 0) + Number(repository.languages.CSS ?? 0);
    const marketingHeavy = languageBytes > 0 && marketingBytes / languageBytes >= 0.65;
    const samplesAreSiteUtilities = repository.representativeFiles.length > 0
      && repository.representativeFiles.every((file) => /(?:^|\/)(?:site|website|landing|assets?)(?:\/|$)/i.test(file.path));
    const veryThin = repository.totalFiles <= 15 && repository.sourceFiles <= 2;
    const ambitiousClaim = infrastructureClaimPattern.test(`${post.text} ${repository.description ?? ""}`);
    return veryThin && ambitiousClaim && (marketingHeavy || samplesAreSiteUtilities);
  });
}

export function hasEstablishedProjectResurface(post: FeedPost, packet: InvestigationPacket) {
  if (packet.preliminaryNewArtifact || concreteFreshLaunchPattern.test(post.text)) return false;
  return packet.repositories.some((repository) => {
    if (!repository.createdAt) return false;
    const createdAt = Date.parse(repository.createdAt);
    if (!Number.isFinite(createdAt)) return false;
    return post.publishedAt - createdAt > 180 * 86_400_000;
  });
}

export function investigationEventKey(prior: PostAnalysis | null, sites: InvestigatorSiteEvidence[], repositories: InvestigatorRepositoryEvidence[], post: FeedPost) {
  const repository = repositories.find((item) => !item.unavailableReason);
  if (repository) return `github:${repository.fullName.toLowerCase()}`;
  const site = sites.find((item) => item.host && !/(?:x|twitter|github)\.com$/i.test(item.host));
  if (site) return `domain:${site.host}`;
  if (prior?.projectKey) return `project:${normalizedName(prior.projectKey)}`;
  return `post:${post.id}`;
}

async function downloadMedia(url: string, destination: string) {
  const parsed = await assertPublicHttpUrl(url);
  if (!/(?:^|\.)twimg\.com$/i.test(parsed.hostname)) throw new Error(`Blocked unexpected media host: ${parsed.hostname}`);
  const response = await fetch(parsed, { signal: AbortSignal.timeout(30_000), headers: { "User-Agent": "ScoutInvestigator/1.0" } });
  if (!response.ok) throw new Error(`Media HTTP ${response.status}`);
  const body = await readLimitedResponse(response, maxMediaBytes);
  if (!body.length || body.length >= maxMediaBytes) throw new Error("Media is empty or exceeds the 40 MB review limit");
  await fs.writeFile(destination, body);
}

async function mediaEvidence(post: FeedPost): Promise<InvestigatorMediaEvidence> {
  if (!post.mediaUrl) return { kind: "none", sourceUrl: null, durationSeconds: null, framePaths: [], unavailableReason: null };
  const directory = path.resolve(process.cwd(), "data", "investigator-media", post.id);
  try {
    await fs.mkdir(directory, { recursive: true });
    const cachedFrames = (await fs.readdir(directory).catch(() => []))
      .filter((item) => /^frame-\d+\.jpg$/.test(item))
      .sort()
      .map((item) => path.join(directory, item));
    if (cachedFrames.length) {
      return { kind: "video", sourceUrl: post.mediaUrl, durationSeconds: null, framePaths: cachedFrames.slice(0, 6), unavailableReason: null };
    }

    let videoUrl: string | null = null;
    if (xSessionConfigured()) {
      const tweet = await getXPostById(post.id).catch(() => null);
      videoUrl = tweet?.videos.find((item) => item.url)?.url ?? null;
    }
    if (videoUrl) {
      const videoPath = path.join(directory, "source.mp4");
      await downloadMedia(videoUrl, videoPath);
      const probe = await execFileAsync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", videoPath], { timeout: 20_000 });
      const duration = Number(probe.stdout.trim());
      await execFileAsync("ffmpeg", [
        "-hide_banner", "-loglevel", "error", "-y", "-i", videoPath,
        "-vf", "fps=1/3,scale=640:-2:force_original_aspect_ratio=decrease",
        "-frames:v", "6", "-q:v", "3", path.join(directory, "frame-%02d.jpg"),
      ], { timeout: 45_000 });
      const frames = (await fs.readdir(directory)).filter((item) => /^frame-\d+\.jpg$/.test(item)).sort().map((item) => path.join(directory, item));
      await fs.unlink(videoPath).catch(() => undefined);
      return { kind: "video", sourceUrl: videoUrl, durationSeconds: Number.isFinite(duration) ? Math.round(duration * 10) / 10 : null, framePaths: frames, unavailableReason: null };
    }

    const imagePath = path.join(directory, "image.jpg");
    await downloadMedia(post.mediaUrl, imagePath);
    return { kind: "image", sourceUrl: post.mediaUrl, durationSeconds: null, framePaths: [imagePath], unavailableReason: null };
  } catch (error) {
    return {
      kind: "image", sourceUrl: post.mediaUrl, durationSeconds: null, framePaths: [],
      unavailableReason: error instanceof Error ? error.message.slice(0, 300) : String(error),
    };
  }
}

function candidateSiteUrls(post: FeedPost, inspection: ArtifactInspection | null | undefined) {
  const values = [
    ...(inspection?.targets.flatMap((target) => [target.finalUrl, target.requestedUrl]) ?? []),
    ...post.externalUrls,
  ].filter((item): item is string => Boolean(item));
  const seen = new Set<string>();
  return values.filter((value) => {
    const normalized = safeUrl(value);
    if (!normalized || seen.has(normalized) || githubRepository(normalized)) return false;
    seen.add(normalized);
    return true;
  }).slice(0, 2);
}

function candidateRepositoryUrls(post: FeedPost, sites: InvestigatorSiteEvidence[], inspection: ArtifactInspection | null | undefined) {
  const values = [
    ...post.externalUrls,
    ...(inspection?.targets.flatMap((target) => [target.finalUrl, target.requestedUrl]) ?? []),
    ...sites.flatMap((site) => site.notableLinks),
  ].filter((item): item is string => Boolean(item));
  const found = new Map<string, string>();
  for (const value of values) {
    const repository = githubRepository(value);
    if (repository) found.set(repository.fullName.toLowerCase(), `https://github.com/${repository.fullName}`);
  }
  return [...found.values()].slice(0, 2);
}

export async function buildInvestigationPacket(post: FeedPost, prior: PostAnalysis | null, inspection: ArtifactInspection | null | undefined, force = false) {
  const previous = getCachedInvestigationPacket(post);
  if (!force && previous) return { packet: previous, cached: true };
  let [profile, sites, media] = await Promise.all([
    cachedProfile(post),
    Promise.all(candidateSiteUrls(post, inspection).map(cachedSite)),
    mediaEvidence(post),
  ]);
  if (previous) {
    if (profile.unavailableReason && !previous.profile.unavailableReason) profile = previous.profile;
    sites = sites.map((site) => {
      const old = previous.sites.find((candidate) => safeUrl(candidate.url) === safeUrl(site.url));
      return site.unavailableReason && old && !old.unavailableReason ? old : site;
    });
    if (!media.framePaths.length && previous.media.framePaths.length) media = previous.media;
  }
  for (const site of sites) {
    if (!site.screenshotPath && inspection?.screenshotPath && comparableHost(site.url) === comparableHost(inspection.targets[0]?.finalUrl ?? inspection.targets[0]?.requestedUrl)) {
      site.screenshotPath = inspection.screenshotPath;
    }
  }
  let repositories = await Promise.all(candidateRepositoryUrls(post, sites, inspection).map(cachedRepository));
  if (previous) {
    repositories = repositories.map((repository) => {
      const old = previous.repositories.find((candidate) => candidate.fullName.toLowerCase() === repository.fullName.toLowerCase());
      if (!old || old.unavailableReason) return repository;
      if (repository.unavailableReason) return old;
      if (!repository.createdAt && old.createdAt) {
        return {
          ...repository,
          description: repository.description ?? old.description,
          createdAt: old.createdAt,
          updatedAt: repository.updatedAt ?? old.updatedAt,
          pushedAt: repository.pushedAt ?? old.pushedAt,
          stars: repository.stars || old.stars,
          forks: repository.forks || old.forks,
          watchers: repository.watchers || old.watchers,
          openIssues: repository.openIssues || old.openIssues,
          sizeKb: repository.sizeKb || old.sizeKb,
          license: repository.license ?? old.license,
          topics: repository.topics.length ? repository.topics : old.topics,
          languages: Object.keys(repository.languages).length ? repository.languages : old.languages,
          contributors: repository.contributors ?? old.contributors,
        };
      }
      return repository;
    });
  }
  const source = sourceRoleHint(post, prior, profile, sites);
  const evidenceGaps: string[] = [];
  if (profile.unavailableReason) evidenceGaps.push("Author profile unavailable");
  if (!sites.length || sites.every((site) => site.unavailableReason)) evidenceGaps.push("No inspectable product site");
  if (!repositories.length && /\b(?:github|open[ -]?source|repository|repo)\b/i.test(post.text)) evidenceGaps.push("Open-source claim without an inspectable repository");
  if (post.mediaUrl && !media.framePaths.length) evidenceGaps.push("Tweet media could not be inspected");
  const packet: InvestigationPacket = {
    postId: post.id,
    contentHash: feedPostContentHash(post),
    version: INVESTIGATOR_VERSION,
    builtAt: Date.now(),
    preliminaryNewArtifact: Boolean(prior?.newArtifact),
    preliminarySignalType: prior?.signalType ?? null,
    sourceRoleHint: source.role,
    sourceRoleReason: source.reason,
    canonicalEventKey: investigationEventKey(prior, sites, repositories, post),
    profile,
    sites,
    repositories,
    media,
    artifactEvidence: artifactPromptEvidence(inspection),
    evidenceGaps,
  };
  saveInvestigationPackets([packet]);
  return { packet, cached: false };
}

export async function captureMissingSiteScreenshots(packets: InvestigationPacket[]) {
  const pending = packets.flatMap((packet) => packet.sites.map((site) => ({ packet, site })))
    .filter(({ site }) => !site.screenshotPath && !site.unavailableReason);
  if (!pending.length) return 0;
  let captured = 0;
  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch({ headless: true });
  try {
    for (const { packet, site } of pending) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: "block" });
      await context.route("**/*", async (route) => {
        const requestUrl = route.request().url();
        if (route.request().resourceType() === "font") return route.abort("blockedbyclient");
        if (/^(?:data|blob):/.test(requestUrl)) return route.continue();
        try {
          await assertPublicHttpUrl(requestUrl);
          return route.continue();
        } catch {
          return route.abort("blockedbyclient");
        }
      });
      try {
        const page = await context.newPage();
        await page.goto(site.url, { waitUntil: "domcontentloaded", timeout: 18_000 });
        await page.waitForTimeout(800);
        const directory = path.resolve(process.cwd(), "data", "investigator-sites");
        await fs.mkdir(directory, { recursive: true });
        const digest = createHash("sha256").update(site.url).digest("hex").slice(0, 16);
        const screenshotPath = path.join(directory, `${digest}.jpg`);
        await page.screenshot({ path: screenshotPath, type: "jpeg", quality: 72, fullPage: false });
        site.screenshotPath = screenshotPath;
        packet.builtAt = Date.now();
        saveInvestigationPackets([packet]);
        captured += 1;
      } catch (error) {
        site.unavailableReason = site.unavailableReason ?? `Screenshot failed: ${error instanceof Error ? error.message.slice(0, 200) : String(error)}`;
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
  return captured;
}
