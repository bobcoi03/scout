"use client";

import {
  ArrowLeft,
  ArrowUpRight,
  ExternalLink,
  Heart,
  Layers3,
  MessageCircle,
  Repeat2,
  Search,
  Table2,
} from "lucide-react";
import Link from "next/link";
import Script from "next/script";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import styles from "@/app/product/product.module.css";
import { ScoutBrand } from "@/components/scout-brand";

export type IntelligenceSignal = {
  id: string;
  date: number;
  category: string;
  signalType: string;
  builderName: string;
  username: string;
  projectName: string;
  projectUrl: string | null;
  discoveryUrl: string;
  description: string | null;
  postText: string;
  mediaUrl: string | null;
  analystScore: number;
  confidence: number;
  likes: number;
  reposts: number;
  replies: number;
  views: number;
};

type ThemeName = "Agent stack" | "Developer tools" | "Creative systems" | "Robotics & spatial" | "Financial infrastructure" | "Consumer & work";
type SortMode = "Latest" | "Conviction";
type ViewMode = "Signals" | "Themes";
type SavedView = "All signals" | "Latest day" | "High conviction" | "Open source";

const themeOrder: ThemeName[] = [
  "Agent stack",
  "Developer tools",
  "Creative systems",
  "Robotics & spatial",
  "Financial infrastructure",
  "Consumer & work",
];

const themeMeta: Record<ThemeName, { color: string; short: string }> = {
  "Agent stack": { color: "#ef3c28", short: "AG" },
  "Developer tools": { color: "#7f9d26", short: "DV" },
  "Creative systems": { color: "#b4568a", short: "CR" },
  "Robotics & spatial": { color: "#477da9", short: "RX" },
  "Financial infrastructure": { color: "#a27618", short: "FI" },
  "Consumer & work": { color: "#7064a6", short: "CW" },
};

function classifyTheme(signal: IntelligenceSignal): ThemeName {
  const text = `${signal.projectName} ${signal.description ?? ""}`.toLowerCase();
  if (/robot|robotics|tactile|spatial|vision pro|three\.js|3d |world model|embodied|simulation/.test(text)) return "Robotics & spatial";
  if (/video|audio|voice|speech|music|design|animation|image|creator|recording|avatar|canvas/.test(text)) return "Creative systems";
  if (/trading|market|finance|financial|payment|wallet|bank|invest|lending|stablecoin|defi|fundrais/.test(text)) return "Financial infrastructure";
  if (/agent|claude|codex|copilot|llm|language model|model routing|prompt|context engine|mcp|ai coding/.test(text)) return "Agent stack";
  if (/developer|github|open.source|framework|sdk|api|database|cli|terminal|codebase|react|typescript|browser/.test(text)) return "Developer tools";
  return "Consumer & work";
}

function formatDate(value: number, includeYear = false) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    ...(includeYear ? { year: "numeric" as const } : {}),
    timeZone: "UTC",
  }).format(value);
}

function formatRange(from: string, to: string) {
  return `${formatDate(Date.parse(`${from}T00:00:00.000Z`))} – ${formatDate(Date.parse(`${to}T00:00:00.000Z`), true)}`;
}

function ordinalSuffix(day: number) {
  const lastTwoDigits = day % 100;
  return lastTwoDigits >= 11 && lastTwoDigits <= 13
    ? "th"
    : day % 10 === 1
      ? "st"
      : day % 10 === 2
        ? "nd"
        : day % 10 === 3
          ? "rd"
          : "th";
}

function formatLocalPostDate(value: number, useLocalTime: boolean) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
    hour12: false,
    ...(useLocalTime ? {} : { timeZone: "UTC" }),
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  const day = Number(part("day"));
  return `${day}${ordinalSuffix(day)} ${part("month")} ${part("year")} · ${part("hour")}:${part("minute")} ${part("timeZoneName")}`;
}

const subscribeToHydration = () => () => {};

function formatSignalType(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function compact(value: number) {
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function dateKey(value: number) {
  return new Date(value).toISOString().slice(0, 10);
}

function hasVideo(signal: IntelligenceSignal) {
  return Boolean(signal.mediaUrl && /(?:video_thumb|video\.twimg\.com)/i.test(signal.mediaUrl));
}

function deltaLabel(current: number, previous: number) {
  const delta = current - previous;
  if (delta === 0) return "No change";
  return `${delta > 0 ? "+" : ""}${delta} vs prior 7d`;
}

export function ProductIntelligence({ signals, from, to }: { signals: IntelligenceSignal[]; from: string; to: string }) {
  const [viewMode, setViewMode] = useState<ViewMode>("Signals");
  const [savedView, setSavedView] = useState<SavedView>("All signals");
  const [theme, setTheme] = useState<ThemeName | "All themes">("All themes");
  const [sortMode, setSortMode] = useState<SortMode>("Latest");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(signals[0]?.id ?? "");
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const inboxRef = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const hasHydrated = useSyncExternalStore(subscribeToHydration, () => true, () => false);

  const enriched = useMemo(() => signals.map((signal) => ({ ...signal, theme: classifyTheme(signal) })), [signals]);
  const latestDate = Math.max(...enriched.map((signal) => signal.date), 0);
  const latestKey = dateKey(latestDate);
  const latestCount = enriched.filter((signal) => dateKey(signal.date) === latestKey).length;
  const openSourceCount = enriched.filter((signal) => signal.signalType === "open_source_launch").length;
  const highConvictionCount = enriched.filter((signal) => signal.analystScore >= 85).length;
  const dayCount = Math.max(1, Math.round((Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / 86_400_000) + 1);

  const dailyVolumes = Array.from({ length: dayCount }, (_, index) => {
    const date = Date.parse(`${from}T00:00:00.000Z`) + index * 86_400_000;
    return { date, count: enriched.filter((signal) => dateKey(signal.date) === dateKey(date)).length };
  });
  const themeSummaries = themeOrder.map((name) => {
    const matches = enriched.filter((signal) => signal.theme === name);
    const recent = matches.filter((signal) => signal.date >= latestDate - 6 * 86_400_000).length;
    const previous = matches.filter((signal) => signal.date < latestDate - 6 * 86_400_000 && signal.date >= latestDate - 13 * 86_400_000).length;
    const leaders = [...matches].sort((a, b) => b.analystScore - a.analystScore || b.date - a.date).slice(0, 3);
    const volumes = dailyVolumes.map((day) => matches.filter((signal) => dateKey(signal.date) === dateKey(day.date)).length);
    return { name, count: matches.length, recent, previous, leaders, volumes };
  });

  const normalizedQuery = query.trim().toLowerCase();
  const filtered = enriched.filter((signal) => {
    if (theme !== "All themes" && signal.theme !== theme) return false;
    if (savedView === "Latest day" && dateKey(signal.date) !== latestKey) return false;
    if (savedView === "High conviction" && signal.analystScore < 85) return false;
    if (savedView === "Open source" && signal.signalType !== "open_source_launch") return false;
    return true;
  });

  const sorted = [...filtered].sort((a, b) => sortMode === "Latest"
    ? b.date - a.date || b.analystScore - a.analystScore
    : b.analystScore - a.analystScore || b.date - a.date);
  const searchResults = normalizedQuery
    ? sorted.filter((signal) => `${signal.projectName} ${signal.username} ${signal.builderName} ${signal.description ?? ""} ${signal.postText}`.toLowerCase().includes(normalizedQuery))
    : [];
  const selectedSignal = sorted.find((signal) => signal.id === selectedId) ?? sorted[0] ?? null;

  const hydrateEmbed = useCallback(() => {
    const shell = detailRef.current?.querySelector<HTMLElement>(".tweet-shell:has(blockquote.twitter-tweet):not(:has(iframe))");
    if (shell && window.twttr?.widgets) window.twttr.widgets.load(shell);
  }, []);

  useEffect(() => {
    if (viewMode !== "Signals" || !selectedSignal) return;
    const detail = detailRef.current;
    const revealShell = (shell: HTMLElement) => {
      if (shell.dataset.ready || shell.dataset.revealPending) return;
      shell.dataset.revealPending = "true";
      window.setTimeout(() => { shell.dataset.ready = "true"; }, 180);
    };
    const markWidgetReady = (event: { target: HTMLElement }) => {
      const shell = event.target.closest<HTMLElement>(".tweet-shell");
      const frame = shell?.querySelector<HTMLIFrameElement>(".twitter-tweet-rendered iframe[title='X Post']");
      if (shell && frame && frame.getBoundingClientRect().height > 100) revealShell(shell);
    };
    const readinessCheck = window.setInterval(() => {
      detail?.querySelectorAll<HTMLElement>(".tweet-shell:not([data-ready='true'])").forEach((shell) => {
        const frame = shell.querySelector<HTMLIFrameElement>(".twitter-tweet-rendered iframe[title='X Post']");
        if (frame && frame.getBoundingClientRect().height > 100) revealShell(shell);
      });
    }, 120);
    let eventsBound = false;
    const bindEvents = () => {
      if (eventsBound || !window.twttr?.events) return;
      window.twttr.events.bind("rendered", markWidgetReady);
      eventsBound = true;
    };

    bindEvents();
    const hydrationRetry = window.setInterval(() => {
      if (!window.twttr?.widgets) return;
      bindEvents();
      hydrateEmbed();
      window.clearInterval(hydrationRetry);
    }, 250);
    hydrateEmbed();

    return () => {
      window.clearInterval(hydrationRetry);
      window.clearInterval(readinessCheck);
      if (eventsBound) window.twttr?.events?.unbind("rendered", markWidgetReady);
    };
  }, [hydrateEmbed, mobileDetailOpen, selectedSignal, viewMode]);

  const savedViews: Array<{ name: SavedView; count: number }> = [
    { name: "All signals", count: enriched.length },
    { name: "Latest day", count: latestCount },
    { name: "High conviction", count: highConvictionCount },
    { name: "Open source", count: openSourceCount },
  ];

  const chooseTheme = (name: ThemeName | "All themes") => {
    setTheme(name);
    setSavedView("All signals");
    setViewMode("Signals");
    setMobileDetailOpen(false);
  };

  const chooseView = (mode: ViewMode) => {
    setViewMode(mode);
    if (mode === "Themes") {
      setSavedView("All signals");
      setTheme("All themes");
      setQuery("");
      setMobileDetailOpen(false);
    }
  };

  const openSignal = (signalId: string) => {
    setSelectedId(signalId);
    if (window.matchMedia("(max-width: 720px)").matches) setMobileDetailOpen(true);
  };

  const jumpToSignal = (signalId: string) => {
    setQuery("");
    openSignal(signalId);
    window.requestAnimationFrame(() => {
      document.getElementById(`signal-${signalId}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  };

  return (
    <>
      <Script src="https://platform.twitter.com/widgets.js" strategy="afterInteractive" onLoad={hydrateEmbed} onReady={hydrateEmbed} />
      <main className={`${styles.shell} ${mobileDetailOpen ? styles.mobileDetailShell : ""}`}>
        <header className={styles.header}>
          <div className={styles.headerBrand}>
            <ScoutBrand />
            <span className={styles.headerDivider} />
            <div><strong>Launch intelligence</strong><span>Research workspace</span></div>
          </div>

          <nav className={styles.viewTabs} aria-label="Intelligence views">
            {(["Signals", "Themes"] as ViewMode[]).map((mode) => <button type="button" key={mode} onClick={() => chooseView(mode)} className={viewMode === mode ? styles.activeViewTab : ""}>{mode === "Signals" ? <Table2 aria-hidden="true" /> : <Layers3 aria-hidden="true" />}{mode}</button>)}
          </nav>

          <div className={styles.headerActions}>
            <span className={styles.liveStatus}>Live data</span>
            <span>{formatRange(from, to)}</span>
            <Link href="/table">Dataset <ArrowUpRight aria-hidden="true" /></Link>
          </div>
        </header>

        <div className={styles.workspace}>
          <aside className={styles.sidebar}>
            <section>
              <p className={styles.sidebarLabel}>Saved views</p>
              <div className={styles.sidebarList}>
                {savedViews.map((item) => <button type="button" key={item.name} onClick={() => { setSavedView(item.name); setTheme("All themes"); setViewMode("Signals"); setMobileDetailOpen(false); }} className={savedView === item.name && theme === "All themes" ? styles.activeSidebarItem : ""}><span>{item.name}</span><small>{item.count}</small></button>)}
              </div>
            </section>

            <section>
              <p className={styles.sidebarLabel}>Themes</p>
              <div className={styles.sidebarList}>
                <button type="button" onClick={() => chooseTheme("All themes")} className={theme === "All themes" ? styles.activeSidebarItem : ""}><span>All themes</span><small>{enriched.length}</small></button>
                {themeSummaries.map((summary) => <button type="button" key={summary.name} onClick={() => chooseTheme(summary.name)} className={theme === summary.name ? styles.activeSidebarItem : ""}><span><i style={{ backgroundColor: themeMeta[summary.name].color }} />{summary.name}</span><small>{summary.count}</small></button>)}
              </div>
            </section>

            <section className={styles.sidebarCoverage}>
              <p className={styles.sidebarLabel}>Coverage</p>
              <dl>
                <div><dt>Window</dt><dd>{dayCount} days</dd></div>
                <div><dt>Source</dt><dd>X launches</dd></div>
                <div><dt>Status</dt><dd><i /> Current</dd></div>
              </dl>
            </section>
          </aside>

          <section className={styles.mainPanel}>
            <div className={styles.panelHeader}>
              <div>
                <p className={styles.kicker}>{viewMode === "Signals" ? "Signal table" : "Theme summary"}</p>
                <h1>{viewMode === "Signals" ? (theme === "All themes" ? savedView : theme) : "Market themes"}</h1>
              </div>
              {viewMode === "Signals" && <div className={styles.headerTools}>
                <div className={styles.searchControl}>
                  <label className={styles.searchBox}>
                    <Search aria-hidden="true" />
                    <span className="sr-only">Search signals</span>
                    <input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") setQuery("");
                        if (event.key === "Enter" && searchResults[0]) jumpToSignal(searchResults[0].id);
                      }}
                      placeholder="Search launches"
                      autoComplete="off"
                      role="combobox"
                      aria-autocomplete="list"
                      aria-expanded={Boolean(normalizedQuery)}
                      aria-controls="signal-search-results"
                    />
                    {query && <button type="button" onClick={() => setQuery("")} aria-label="Clear search">×</button>}
                  </label>
                  {normalizedQuery && <div id="signal-search-results" className={styles.searchDropdown} role="listbox" aria-label="Matching launches">
                    <div className={styles.searchDropdownHeader}><span>Matching launches</span><strong>{searchResults.length}</strong></div>
                    {searchResults.length ? searchResults.slice(0, 50).map((signal) => <button type="button" role="option" aria-selected={selectedSignal?.id === signal.id} key={signal.id} onClick={() => jumpToSignal(signal.id)}>
                      <span><strong>{signal.projectName}</strong><small>@{signal.username} · {signal.theme}</small><em>{signal.description ?? signal.postText}</em></span>
                      <b>{Math.round(signal.analystScore)}</b>
                    </button>) : <p className={styles.noSearchResults}>No launches match “{query.trim()}”.</p>}
                  </div>}
                </div>
                <div className={styles.sortTabs} aria-label="Sort signals">
                  {(["Latest", "Conviction"] as SortMode[]).map((mode) => <button type="button" key={mode} onClick={() => setSortMode(mode)} className={sortMode === mode ? styles.activeSort : ""}>{mode}</button>)}
                </div>
              </div>}
            </div>

            {viewMode === "Signals" ? <div className={`${styles.inboxWorkspace} ${mobileDetailOpen ? styles.mobileDetailActive : ""}`}>
              <section className={styles.inboxPane}>
                <div className={styles.inboxToolbar}><span>{sorted.length} launches</span><small>{theme === "All themes" ? savedView : theme}</small></div>
                <div ref={inboxRef} className={styles.signalInbox} data-testid="intelligence-signal-inbox">
                  {sorted.length ? sorted.map((signal, index) => <button
                    id={`signal-${signal.id}`}
                    type="button"
                    key={signal.id}
                    onClick={() => openSignal(signal.id)}
                    className={`${styles.inboxRow} ${selectedSignal?.id === signal.id ? styles.activeInboxRow : ""}`}
                    data-testid="intelligence-signal-row"
                  >
                    <span className={styles.inboxRowTop}><span><i style={{ backgroundColor: themeMeta[signal.theme].color }} />{signal.theme}</span><strong>{Math.round(signal.analystScore)}</strong></span>
                    <span className={styles.inboxProject}>{signal.projectName}</span>
                    <span className={styles.inboxDescription}>{signal.description ?? "No launch description is available for this record."}</span>
                    <span className={styles.inboxMeta}><span>@{signal.username}</span><span>{formatLocalPostDate(signal.date, hasHydrated)}</span>{hasVideo(signal) && <span className={styles.videoBadge}>Video</span>}<small>{String(index + 1).padStart(2, "0")}</small></span>
                  </button>) : <div className={styles.emptyState}><Search aria-hidden="true" /><strong>No launches in this view</strong><span>Choose a broader saved view or theme.</span></div>}
                </div>
              </section>

              <section ref={detailRef} className={styles.evidenceCanvas} data-testid="intelligence-evidence-canvas">
                {selectedSignal ? <>
                  <div className={styles.mobileDetailBar}>
                    <button type="button" onClick={() => setMobileDetailOpen(false)} aria-label="Back to launch inbox"><ArrowLeft aria-hidden="true" /></button>
                    <div><strong>{selectedSignal.projectName}</strong><span>@{selectedSignal.username}</span></div>
                    <a href={selectedSignal.discoveryUrl} target="_blank" rel="noreferrer" aria-label="Open source post on X"><ExternalLink aria-hidden="true" /></a>
                  </div>
                  <div className={styles.evidenceHeader}>
                    <div className={styles.evidenceEyebrow}><span><i style={{ backgroundColor: themeMeta[selectedSignal.theme].color }} />{selectedSignal.theme}</span><span>{formatDate(selectedSignal.date, true)}</span></div>
                    <div className={styles.evidenceTitle}><h2>{selectedSignal.projectName}</h2><span className={styles.score}><strong>{Math.round(selectedSignal.analystScore)}</strong><small>/ 100</small></span></div>
                    <p className={styles.evidenceDescription}>{selectedSignal.description ?? "No launch description is available for this record."}</p>
                    <div className={styles.evidenceBuilder}><span>Builder</span><div><strong>{selectedSignal.builderName}</strong><a href={`https://x.com/${encodeURIComponent(selectedSignal.username)}`} target="_blank" rel="noreferrer">@{selectedSignal.username}<ExternalLink aria-hidden="true" /></a></div></div>
                    <div className={styles.recordLinks}>
                      <a className={styles.primaryLink} href={selectedSignal.discoveryUrl} target="_blank" rel="noreferrer">View launch post <ExternalLink aria-hidden="true" /></a>
                      {selectedSignal.projectUrl && <a href={selectedSignal.projectUrl} target="_blank" rel="noreferrer">Open product <ExternalLink aria-hidden="true" /></a>}
                    </div>
                    <dl className={styles.recordMeta}>
                      <div><dt>Signal</dt><dd>{formatSignalType(selectedSignal.signalType)}</dd></div>
                      <div><dt>Confidence</dt><dd>{Math.round(selectedSignal.confidence)}%</dd></div>
                      <div><dt>Views</dt><dd>{compact(selectedSignal.views)}</dd></div>
                      <div><dt>Category</dt><dd>{selectedSignal.category}</dd></div>
                    </dl>
                  </div>

                  <div className={styles.tweetEvidence}>
                    <div className={styles.sourceTopline}>
                      <span>{hasVideo(selectedSignal) ? "Launch post · video" : "Launch post"}</span>
                      <a href={selectedSignal.discoveryUrl} target="_blank" rel="noreferrer">Open on X <ArrowUpRight aria-hidden="true" /></a>
                    </div>
                    <div key={selectedSignal.id} className={`${styles.embeddedTweet} tweet-shell`} data-post-id={selectedSignal.id}>
                      <div className="tweet-skeleton" role="status" aria-label="Loading X post">
                        <div className="tweet-skeleton-head"><span /><div><i /><i /></div></div>
                        <div className="tweet-skeleton-lines"><i /><i /><i /><i /></div>
                        <div className="tweet-skeleton-media" />
                        <span className="sr-only">Loading X post</span>
                      </div>
                      <blockquote className="twitter-tweet" data-theme="light" data-link-color="#e42313" data-dnt="true" data-conversation="none">
                        <p lang="en" dir="ltr">{selectedSignal.postText}</p>
                        &mdash; {selectedSignal.builderName} (@{selectedSignal.username}) <a href={selectedSignal.discoveryUrl}>{formatDate(selectedSignal.date)}</a>
                      </blockquote>
                    </div>
                    <div className={styles.postActivity}>
                      <span><Heart aria-hidden="true" />{compact(selectedSignal.likes)}</span>
                      <span><Repeat2 aria-hidden="true" />{compact(selectedSignal.reposts)}</span>
                      <span><MessageCircle aria-hidden="true" />{compact(selectedSignal.replies)}</span>
                      <span>{compact(selectedSignal.views)} views</span>
                    </div>
                  </div>
                </> : <div className={styles.emptyState}><Search aria-hidden="true" /><strong>No launch selected</strong></div>}
              </section>
            </div> : <div className={styles.themeGrid} data-testid="intelligence-theme-grid">
              {themeSummaries.map((summary) => {
                const maxThemeVolume = Math.max(...summary.volumes, 1);
                return <article key={summary.name} className={styles.themeCard}>
                  <header><span><i style={{ backgroundColor: themeMeta[summary.name].color }} />{themeMeta[summary.name].short}</span><button type="button" onClick={() => chooseTheme(summary.name)}>View signals <ArrowUpRight aria-hidden="true" /></button></header>
                  <div className={styles.themeCardTitle}><div><h2>{summary.name}</h2><p>{deltaLabel(summary.recent, summary.previous)}</p></div><strong>{summary.count}<small>signals</small></strong></div>
                  <div className={styles.themeBars}>{summary.volumes.map((count, index) => <i key={index} title={`${dateKey(dailyVolumes[index].date)}: ${count}`} style={{ height: `${Math.max(8, (count / maxThemeVolume) * 100)}%`, backgroundColor: themeMeta[summary.name].color }} />)}</div>
                  <div className={styles.themeLeaders}><span>Highest conviction</span>{summary.leaders.map((signal) => <button type="button" key={signal.id} onClick={() => chooseTheme(summary.name)}><span>{signal.projectName}</span><strong>{Math.round(signal.analystScore)}</strong></button>)}</div>
                </article>;
              })}
            </div>}
          </section>
        </div>
      </main>
    </>
  );
}
