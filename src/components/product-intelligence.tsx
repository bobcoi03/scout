"use client";

import {
  ArrowLeft,
  ArrowUpRight,
  ChevronDown,
  ExternalLink,
  Heart,
  Layers3,
  MessageCircle,
  Repeat2,
  Search,
  SlidersHorizontal,
  Table2,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import Script from "next/script";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import styles from "@/app/product/product.module.css";
import { RepositoryLink } from "@/components/repository-link";
import { ScoutBrand } from "@/components/scout-brand";
import { displayProjectName } from "@/lib/project-name";

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

export type ThemeName = "Agent stack" | "Developer tools" | "Creative systems" | "Robotics & spatial" | "Financial infrastructure" | "Consumer & work";
type SortMode = "Latest" | "Conviction";
type ViewMode = "Signals" | "Themes";
type SavedView = "All signals" | "Latest day" | "High conviction" | "Open source";

export const themeOrder: ThemeName[] = [
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

type ThemedSignal = IntelligenceSignal & { theme: ThemeName };
type ThemeMetric = "Launches" | "Conviction";
type ThemeWindow = "All" | "30d" | "60d" | "90d";
type SourceFilter = "All sources" | "New releases" | "Open source" | "Product demos" | "New founders";

type PersonSummary = {
  username: string;
  name: string;
  signals: number;
  projects: string[];
  themes: ThemeName[];
  dominantTheme: ThemeName;
  averageScore: number;
  maxScore: number;
  totalViews: number;
  latestDate: number;
};

const DAY = 86_400_000;
const chartWidth = 920;
const chartHeight = 250;
const chartPadding = { top: 20, right: 18, bottom: 32, left: 42 };

function startOfUtcWeek(value: number) {
  const date = new Date(value);
  const weekday = (date.getUTCDay() + 6) % 7;
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - weekday);
}

function aggregatePeople(signals: ThemedSignal[]): PersonSummary[] {
  const people = new Map<string, {
    username: string;
    name: string;
    signals: number;
    projects: Set<string>;
    themes: Map<ThemeName, number>;
    scoreTotal: number;
    maxScore: number;
    totalViews: number;
    latestDate: number;
  }>();

  for (const signal of signals) {
    const key = signal.username.toLowerCase();
    const person = people.get(key) ?? {
      username: signal.username,
      name: signal.builderName || signal.username,
      signals: 0,
      projects: new Set<string>(),
      themes: new Map<ThemeName, number>(),
      scoreTotal: 0,
      maxScore: 0,
      totalViews: 0,
      latestDate: 0,
    };
    person.signals += 1;
    person.projects.add(displayProjectName(signal.projectName));
    person.themes.set(signal.theme, (person.themes.get(signal.theme) ?? 0) + 1);
    person.scoreTotal += signal.analystScore;
    person.maxScore = Math.max(person.maxScore, signal.analystScore);
    person.totalViews += signal.views;
    person.latestDate = Math.max(person.latestDate, signal.date);
    people.set(key, person);
  }

  return [...people.values()].map((person) => {
    const themes = [...person.themes.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);
    return {
      username: person.username,
      name: person.name,
      signals: person.signals,
      projects: [...person.projects],
      themes,
      dominantTheme: themes[0] ?? "Consumer & work",
      averageScore: person.scoreTotal / person.signals,
      maxScore: person.maxScore,
      totalViews: person.totalViews,
      latestDate: person.latestDate,
    };
  });
}

function ThemeWorkbench({
  signals,
  latestDate,
  activeTheme,
  onThemeChange,
}: {
  signals: ThemedSignal[];
  latestDate: number;
  activeTheme: ThemeName | "All themes";
  onThemeChange: (theme: ThemeName | "All themes") => void;
}) {
  const [windowSize, setWindowSize] = useState<ThemeWindow>("All");
  const [minimumScore, setMinimumScore] = useState(0);
  const [source, setSource] = useState<SourceFilter>("All sources");
  const [metric, setMetric] = useState<ThemeMetric>("Launches");
  const [personQuery, setPersonQuery] = useState("");
  const [selectedPeople, setSelectedPeople] = useState<string[]>([]);
  const [hoveredWeek, setHoveredWeek] = useState<number | null>(null);
  const [hoveredPerson, setHoveredPerson] = useState<string | null>(null);

  const windowDays = windowSize === "All" ? null : Number.parseInt(windowSize, 10);
  const cutoff = windowDays ? latestDate - (windowDays - 1) * DAY : Number.NEGATIVE_INFINITY;
  const contextSignals = useMemo(() => signals.filter((signal) => {
    if (signal.date < cutoff) return false;
    if (activeTheme !== "All themes" && signal.theme !== activeTheme) return false;
    if (source !== "All sources" && signal.category !== source) return false;
    return signal.analystScore >= minimumScore;
  }), [activeTheme, cutoff, minimumScore, signals, source]);
  const filteredSignals = useMemo(() => selectedPeople.length
    ? contextSignals.filter((signal) => selectedPeople.includes(signal.username.toLowerCase()))
    : contextSignals, [contextSignals, selectedPeople]);

  const allPeople = useMemo(() => aggregatePeople(contextSignals)
    .sort((a, b) => b.signals - a.signals || b.maxScore - a.maxScore || b.totalViews - a.totalViews), [contextSignals]);
  const selectedPeopleDetails = selectedPeople
    .map((username) => allPeople.find((person) => person.username.toLowerCase() === username))
    .filter((person): person is PersonSummary => Boolean(person));
  const normalizedPersonQuery = personQuery.trim().toLowerCase();
  const peopleMatches = normalizedPersonQuery
    ? allPeople.filter((person) => `${person.name} ${person.username} ${person.projects.join(" ")}`.toLowerCase().includes(normalizedPersonQuery)).slice(0, 8)
    : [];

  const togglePerson = (username: string) => {
    const key = username.toLowerCase();
    setSelectedPeople((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key]);
    setPersonQuery("");
  };

  const filteredPeople = useMemo(() => aggregatePeople(filteredSignals), [filteredSignals]);
  const uniqueProjects = new Set(filteredSignals.map((signal) => signal.projectName.toLowerCase())).size;
  const averageConviction = filteredSignals.length
    ? filteredSignals.reduce((sum, signal) => sum + signal.analystScore, 0) / filteredSignals.length
    : 0;
  const totalViews = filteredSignals.reduce((sum, signal) => sum + signal.views, 0);

  const themeBreakdown = themeOrder.map((name) => {
    const matches = filteredSignals.filter((signal) => signal.theme === name);
    return {
      name,
      count: matches.length,
      people: new Set(matches.map((signal) => signal.username.toLowerCase())).size,
      averageScore: matches.length ? matches.reduce((sum, signal) => sum + signal.analystScore, 0) / matches.length : 0,
    };
  });
  const maximumThemeCount = Math.max(...themeBreakdown.map((item) => item.count), 1);

  const firstDate = contextSignals.length ? Math.min(...contextSignals.map((signal) => signal.date)) : latestDate;
  const firstWeek = startOfUtcWeek(Math.max(firstDate, Number.isFinite(cutoff) ? cutoff : firstDate));
  const lastWeek = startOfUtcWeek(latestDate);
  const weeklyData = [] as Array<{
    date: number;
    total: number;
    values: Record<ThemeName, number | null>;
    counts: Record<ThemeName, number>;
  }>;
  for (let date = firstWeek; date <= lastWeek; date += 7 * DAY) {
    const weekSignals = filteredSignals.filter((signal) => signal.date >= date && signal.date < date + 7 * DAY);
    const values = {} as Record<ThemeName, number | null>;
    const counts = {} as Record<ThemeName, number>;
    for (const name of themeOrder) {
      const matches = weekSignals.filter((signal) => signal.theme === name);
      counts[name] = matches.length;
      values[name] = metric === "Launches"
        ? matches.length
        : matches.length ? matches.reduce((sum, signal) => sum + signal.analystScore, 0) / matches.length : null;
    }
    weeklyData.push({ date, total: weekSignals.length, values, counts });
  }

  const visibleThemes = activeTheme === "All themes" ? themeOrder : [activeTheme];
  const scoreFloor = 40;
  const maximumChartValue = metric === "Launches"
    ? Math.max(...weeklyData.flatMap((week) => visibleThemes.map((name) => week.values[name] ?? 0)), 1)
    : 100;
  const plotWidth = chartWidth - chartPadding.left - chartPadding.right;
  const plotHeight = chartHeight - chartPadding.top - chartPadding.bottom;
  const xFor = (index: number) => chartPadding.left + (weeklyData.length <= 1 ? plotWidth / 2 : (index / (weeklyData.length - 1)) * plotWidth);
  const yFor = (value: number) => {
    const minimum = metric === "Launches" ? 0 : scoreFloor;
    return chartPadding.top + plotHeight - ((Math.max(minimum, value) - minimum) / Math.max(1, maximumChartValue - minimum)) * plotHeight;
  };
  const lineFor = (name: ThemeName) => weeklyData.reduce((path, week, index) => {
    const value = week.values[name];
    if (value == null) return path;
    return `${path}${path ? " L" : "M"}${xFor(index).toFixed(1)},${yFor(value).toFixed(1)}`;
  }, "");

  const handleWeekPointer = (event: React.PointerEvent<SVGRectElement>) => {
    if (!weeklyData.length) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const svgX = ((event.clientX - bounds.left) / bounds.width) * chartWidth;
    const ratio = Math.max(0, Math.min(1, (svgX - chartPadding.left) / plotWidth));
    setHoveredWeek(Math.round(ratio * Math.max(0, weeklyData.length - 1)));
  };

  const scatterPeople = allPeople
    .filter((person) => person.signals > 0)
    .sort((a, b) => b.maxScore + Math.log10(b.totalViews + 1) * 2 - (a.maxScore + Math.log10(a.totalViews + 1) * 2))
    .slice(0, 100);
  const scatterWidth = 680;
  const scatterHeight = 274;
  const scatterPadding = { top: 24, right: 22, bottom: 38, left: 44 };
  const scatterPlotWidth = scatterWidth - scatterPadding.left - scatterPadding.right;
  const scatterPlotHeight = scatterHeight - scatterPadding.top - scatterPadding.bottom;
  const reachValues = scatterPeople.map((person) => Math.log10(person.totalViews + 1));
  const minimumReach = Math.min(...reachValues, 0);
  const maximumReach = Math.max(...reachValues, 1);
  const scatterX = (person: PersonSummary) => scatterPadding.left + ((Math.log10(person.totalViews + 1) - minimumReach) / Math.max(1, maximumReach - minimumReach)) * scatterPlotWidth;
  const scatterY = (person: PersonSummary) => scatterPadding.top + scatterPlotHeight - ((Math.max(scoreFloor, person.averageScore) - scoreFloor) / (100 - scoreFloor)) * scatterPlotHeight;
  const hoveredPersonDetails = hoveredPerson ? scatterPeople.find((person) => person.username.toLowerCase() === hoveredPerson) : null;
  const peopleRows = (normalizedPersonQuery ? peopleMatches : allPeople).slice(0, 12);

  const clearFilters = () => {
    setWindowSize("All");
    setMinimumScore(0);
    setSource("All sources");
    setSelectedPeople([]);
    setPersonQuery("");
    onThemeChange("All themes");
  };

  const activeFilterCount = Number(windowSize !== "All") + Number(minimumScore > 0) + Number(source !== "All sources")
    + Number(activeTheme !== "All themes") + selectedPeople.length;
  const signalsHref = activeTheme === "All themes" ? "/product" : `/product?theme=${encodeURIComponent(activeTheme)}`;

  return <div className={styles.themeWorkbench} data-testid="intelligence-theme-workbench">
    <section className={styles.themeFilters} aria-label="Theme filters">
      <div className={styles.filterLead}><SlidersHorizontal aria-hidden="true" /><div><strong>Explore the signal set</strong><span>Every control updates every chart.</span></div></div>
      <div className={styles.windowTabs} aria-label="Time window">
        {(["30d", "60d", "90d", "All"] as ThemeWindow[]).map((value) => <button type="button" key={value} className={windowSize === value ? styles.activeFilter : ""} onClick={() => setWindowSize(value)}>{value}</button>)}
      </div>
      <label className={styles.sourceSelect}><span>Source</span><select value={source} onChange={(event) => setSource(event.target.value as SourceFilter)}>
        {(["All sources", "New releases", "Open source", "Product demos", "New founders"] as SourceFilter[]).map((value) => <option key={value}>{value}</option>)}
      </select><ChevronDown aria-hidden="true" /></label>
      <label className={styles.scoreFilter}><span>Min conviction <strong>{minimumScore || "Any"}</strong></span><input type="range" min="0" max="95" step="5" value={minimumScore} onChange={(event) => setMinimumScore(Number(event.target.value))} /></label>
      <div className={styles.peoplePicker}>
        <label><Users aria-hidden="true" /><span className="sr-only">Filter by builder</span><input value={personQuery} onChange={(event) => setPersonQuery(event.target.value)} placeholder="Filter by builder" autoComplete="off" /></label>
        {normalizedPersonQuery && <div className={styles.peopleMatches}>
          {peopleMatches.length ? peopleMatches.map((person) => <button type="button" key={person.username} onClick={() => togglePerson(person.username)}><span><strong>{person.name}</strong><small>@{person.username} · {person.projects.slice(0, 2).join(", ")}</small></span><b>{person.signals}</b></button>) : <p>No builders match.</p>}
        </div>}
      </div>
      <button type="button" className={styles.clearFilters} onClick={clearFilters} disabled={!activeFilterCount}>Reset{activeFilterCount ? ` (${activeFilterCount})` : ""}</button>
    </section>

    {selectedPeopleDetails.length > 0 && <div className={styles.selectedPeople} aria-label="Selected builders">
      <span>Builders</span>{selectedPeopleDetails.map((person) => <button type="button" key={person.username} onClick={() => togglePerson(person.username)}>{person.name}<X aria-hidden="true" /></button>)}
    </div>}

    <section className={styles.themeStats} aria-label="Filtered dataset summary">
      <div><span>Signals</span><strong>{filteredSignals.length}</strong><small>curated launches</small></div>
      <div><span>Builders</span><strong>{filteredPeople.length}</strong><small>unique X accounts</small></div>
      <div><span>Projects</span><strong>{uniqueProjects}</strong><small>deduplicated names</small></div>
      <div><span>Avg conviction</span><strong>{averageConviction ? Math.round(averageConviction) : "—"}</strong><small>out of 100</small></div>
      <div><span>Observed reach</span><strong>{compact(totalViews)}</strong><small>post views</small></div>
    </section>

    <section className={styles.analyticsGrid}>
      <article className={styles.analyticsCard}>
        <header className={styles.analyticsHeader}><div><span>Signal velocity</span><h2>{metric === "Launches" ? "Where launch activity is accelerating" : "How conviction is moving"}</h2></div><div className={styles.metricTabs}>{(["Launches", "Conviction"] as ThemeMetric[]).map((value) => <button type="button" key={value} onClick={() => { setMetric(value); setHoveredWeek(null); }} className={metric === value ? styles.activeMetric : ""}>{value}</button>)}</div></header>
        <div className={styles.themeLegend}>{themeOrder.map((name) => <button type="button" key={name} onClick={() => onThemeChange(activeTheme === name ? "All themes" : name)} className={activeTheme !== "All themes" && activeTheme !== name ? styles.mutedLegend : ""}><i style={{ backgroundColor: themeMeta[name].color }} />{name}</button>)}</div>
        <div className={styles.velocityChart}>
          <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} role="img" aria-label={`${metric} by theme and week`}>
            {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
              const value = metric === "Launches" ? maximumChartValue * (1 - ratio) : 100 - (100 - scoreFloor) * ratio;
              const y = chartPadding.top + ratio * plotHeight;
              return <g key={ratio}><line x1={chartPadding.left} x2={chartWidth - chartPadding.right} y1={y} y2={y} className={styles.chartGridLine} /><text x={chartPadding.left - 8} y={y + 3} textAnchor="end">{Math.round(value)}</text></g>;
            })}
            {visibleThemes.map((name) => <g key={name}>
              <path d={lineFor(name)} fill="none" stroke={themeMeta[name].color} strokeWidth={activeTheme === name ? 3 : 2} vectorEffect="non-scaling-stroke" />
              {weeklyData.map((week, index) => week.values[name] == null ? null : <circle key={week.date} cx={xFor(index)} cy={yFor(week.values[name] ?? 0)} r={activeTheme === name ? 3.5 : 2.5} fill={themeMeta[name].color}><title>{`${formatDate(week.date)} · ${name}: ${metric === "Launches" ? week.values[name] : Math.round(week.values[name] ?? 0)}`}</title></circle>)}
            </g>)}
            {hoveredWeek != null && weeklyData[hoveredWeek] && <line x1={xFor(hoveredWeek)} x2={xFor(hoveredWeek)} y1={chartPadding.top} y2={chartPadding.top + plotHeight} className={styles.chartCrosshair} />}
            <rect x={chartPadding.left} y={chartPadding.top} width={plotWidth} height={plotHeight} fill="transparent" onPointerMove={handleWeekPointer} onPointerLeave={() => setHoveredWeek(null)} />
            {[0, Math.floor((weeklyData.length - 1) / 2), weeklyData.length - 1].filter((value, index, values) => value >= 0 && values.indexOf(value) === index).map((index) => <text key={index} x={xFor(index)} y={chartHeight - 7} textAnchor={index === 0 ? "start" : index === weeklyData.length - 1 ? "end" : "middle"}>{formatDate(weeklyData[index].date)}</text>)}
          </svg>
          {hoveredWeek != null && weeklyData[hoveredWeek] && <div className={styles.chartTooltip} style={{ left: `${(xFor(hoveredWeek) / chartWidth) * 100}%` }}><strong>Week of {formatDate(weeklyData[hoveredWeek].date)}</strong>{visibleThemes.map((name) => <span key={name}><i style={{ backgroundColor: themeMeta[name].color }} />{name}<b>{metric === "Launches" ? weeklyData[hoveredWeek].counts[name] : weeklyData[hoveredWeek].values[name] == null ? "—" : Math.round(weeklyData[hoveredWeek].values[name] ?? 0)}</b></span>)}</div>}
        </div>
      </article>

      <article className={styles.analyticsCard}>
        <header className={styles.analyticsHeader}><div><span>Market composition</span><h2>Share of curated launches</h2></div><Link href={signalsHref}>Open records <ArrowUpRight aria-hidden="true" /></Link></header>
        <div className={styles.compositionBars}>{themeBreakdown.map((item) => <button type="button" key={item.name} onClick={() => onThemeChange(activeTheme === item.name ? "All themes" : item.name)} className={activeTheme === item.name ? styles.activeComposition : ""}>
          <span><i style={{ backgroundColor: themeMeta[item.name].color }} />{item.name}<small>{item.people} builders</small></span><strong>{item.count}</strong><em><i style={{ width: `${(item.count / maximumThemeCount) * 100}%`, backgroundColor: themeMeta[item.name].color }} /></em><small>{item.averageScore ? `${Math.round(item.averageScore)} avg conviction` : "No signals"}</small>
        </button>)}</div>
      </article>

      <article className={styles.analyticsCard}>
        <header className={styles.analyticsHeader}><div><span>Builder map</span><h2>Conviction versus observed reach</h2></div><p>Click a point to cross-filter</p></header>
        <div className={styles.scatterChart}>
          <svg viewBox={`0 0 ${scatterWidth} ${scatterHeight}`} role="img" aria-label="Builders plotted by observed reach and average conviction">
            {[50, 65, 80, 95].map((score) => <g key={score}><line x1={scatterPadding.left} x2={scatterWidth - scatterPadding.right} y1={scatterY({ averageScore: score } as PersonSummary)} y2={scatterY({ averageScore: score } as PersonSummary)} className={styles.chartGridLine} /><text x={scatterPadding.left - 8} y={scatterY({ averageScore: score } as PersonSummary) + 3} textAnchor="end">{score}</text></g>)}
            {scatterPeople.map((person) => {
              const selected = selectedPeople.includes(person.username.toLowerCase());
              return <circle key={person.username} cx={scatterX(person)} cy={scatterY(person)} r={Math.min(11, 4 + Math.sqrt(person.signals) * 1.7)} fill={themeMeta[person.dominantTheme].color} fillOpacity={selected ? 1 : .64} stroke={selected ? "#171717" : "rgba(23,23,23,.28)"} strokeWidth={selected ? 2.5 : 1} tabIndex={0} role="button" aria-label={`${person.name}, ${person.signals} signals, ${Math.round(person.averageScore)} conviction`} onMouseEnter={() => setHoveredPerson(person.username.toLowerCase())} onMouseLeave={() => setHoveredPerson(null)} onFocus={() => setHoveredPerson(person.username.toLowerCase())} onBlur={() => setHoveredPerson(null)} onClick={() => togglePerson(person.username)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") togglePerson(person.username); }}><title>{`${person.name} · ${compact(person.totalViews)} views · ${Math.round(person.averageScore)} conviction`}</title></circle>;
            })}
            <text x={scatterPadding.left + scatterPlotWidth / 2} y={scatterHeight - 7} textAnchor="middle" className={styles.axisTitle}>Observed post reach →</text>
          </svg>
          {hoveredPersonDetails && <div className={styles.scatterTooltip}><i style={{ backgroundColor: themeMeta[hoveredPersonDetails.dominantTheme].color }} /><span><strong>{hoveredPersonDetails.name}</strong><small>@{hoveredPersonDetails.username}</small></span><b>{Math.round(hoveredPersonDetails.averageScore)}<small>conviction</small></b><b>{compact(hoveredPersonDetails.totalViews)}<small>views</small></b></div>}
        </div>
      </article>

      <article className={`${styles.analyticsCard} ${styles.peopleCard}`}>
        <header className={styles.analyticsHeader}><div><span>People index</span><h2>Builders behind the signals</h2></div><strong>{allPeople.length}</strong></header>
        <label className={styles.peopleTableSearch}><Search aria-hidden="true" /><span className="sr-only">Search builders and projects</span><input value={personQuery} onChange={(event) => setPersonQuery(event.target.value)} placeholder="Search people or projects" /></label>
        <div className={styles.peopleTable} role="list">
          {peopleRows.map((person) => <button type="button" role="listitem" key={person.username} onClick={() => togglePerson(person.username)} className={selectedPeople.includes(person.username.toLowerCase()) ? styles.activePersonRow : ""}>
            <span className={styles.personIdentity}><i style={{ backgroundColor: themeMeta[person.dominantTheme].color }}>{person.name.slice(0, 1).toUpperCase()}</i><span><strong>{person.name}</strong><small>@{person.username}</small></span></span>
            <span className={styles.personProjects}>{person.projects.slice(0, 2).join(" · ")}</span>
            <span className={styles.personMetric}><strong>{person.signals}</strong><small>signals</small></span>
            <span className={styles.personMetric}><strong>{Math.round(person.averageScore)}</strong><small>conviction</small></span>
            <a href={`https://x.com/${encodeURIComponent(person.username)}`} target="_blank" rel="noreferrer" aria-label={`Open ${person.name} on X`} onClick={(event) => event.stopPropagation()}><ArrowUpRight aria-hidden="true" /></a>
          </button>)}
        </div>
      </article>
    </section>
  </div>;
}

export function ProductIntelligence({
  signals,
  from,
  to,
  initialView = "Signals",
  initialTheme = "All themes",
}: {
  signals: IntelligenceSignal[];
  from: string;
  to: string;
  initialView?: ViewMode;
  initialTheme?: ThemeName | "All themes";
}) {
  const viewMode = initialView;
  const [savedView, setSavedView] = useState<SavedView>("All signals");
  const [theme, setTheme] = useState<ThemeName | "All themes">(initialTheme);
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
    ? sorted.filter((signal) => `${displayProjectName(signal.projectName)} ${signal.username} ${signal.builderName} ${signal.description ?? ""} ${signal.postText}`.toLowerCase().includes(normalizedQuery))
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
    setMobileDetailOpen(false);
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
            <Link href="/product" className={viewMode === "Signals" ? styles.activeViewTab : ""}><Table2 aria-hidden="true" />Signals</Link>
            <Link href="/product/theme" className={viewMode === "Themes" ? styles.activeViewTab : ""}><Layers3 aria-hidden="true" />Themes</Link>
          </nav>

          <div className={styles.headerActions}>
            <span className={styles.liveStatus}>Live data</span>
            <span>{formatRange(from, to)}</span>
            <Link href="/table">Dataset <ArrowUpRight aria-hidden="true" /></Link>
            <RepositoryLink className={styles.repositoryLink} />
          </div>
        </header>

        <div className={styles.workspace}>
          <aside className={styles.sidebar}>
            <section>
              <p className={styles.sidebarLabel}>Saved views</p>
              <div className={styles.sidebarList}>
                {savedViews.map((item) => viewMode === "Signals"
                  ? <button type="button" key={item.name} onClick={() => { setSavedView(item.name); setTheme("All themes"); setMobileDetailOpen(false); }} className={savedView === item.name && theme === "All themes" ? styles.activeSidebarItem : ""}><span>{item.name}</span><small>{item.count}</small></button>
                  : <Link key={item.name} href="/product"><span>{item.name}</span><small>{item.count}</small></Link>)}
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
                      <span><strong>{displayProjectName(signal.projectName)}</strong><small>@{signal.username} · {signal.theme}</small><em>{signal.description ?? signal.postText}</em></span>
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
                    <span className={styles.inboxProject}>{displayProjectName(signal.projectName)}</span>
                    <span className={styles.inboxDescription}>{signal.description ?? "No launch description is available for this record."}</span>
                    <span className={styles.inboxMeta}><span>@{signal.username}</span><span>{formatLocalPostDate(signal.date, hasHydrated)}</span>{hasVideo(signal) && <span className={styles.videoBadge}>Video</span>}<small>{String(index + 1).padStart(2, "0")}</small></span>
                  </button>) : <div className={styles.emptyState}><Search aria-hidden="true" /><strong>No launches in this view</strong><span>Choose a broader saved view or theme.</span></div>}
                </div>
              </section>

              <section ref={detailRef} className={styles.evidenceCanvas} data-testid="intelligence-evidence-canvas">
                {selectedSignal ? <>
                  <div className={styles.mobileDetailBar}>
                    <button type="button" onClick={() => setMobileDetailOpen(false)} aria-label="Back to launch inbox"><ArrowLeft aria-hidden="true" /></button>
                    <div><strong>{displayProjectName(selectedSignal.projectName)}</strong><span>@{selectedSignal.username}</span></div>
                    <a href={selectedSignal.discoveryUrl} target="_blank" rel="noreferrer" aria-label="Open source post on X"><ExternalLink aria-hidden="true" /></a>
                  </div>
                  <div className={styles.evidenceHeader}>
                    <div className={styles.evidenceEyebrow}><span><i style={{ backgroundColor: themeMeta[selectedSignal.theme].color }} />{selectedSignal.theme}</span><span>{formatDate(selectedSignal.date, true)}</span></div>
                    <div className={styles.evidenceTitle}><h2>{displayProjectName(selectedSignal.projectName)}</h2><span className={styles.score}><strong>{Math.round(selectedSignal.analystScore)}</strong><small>/ 100</small></span></div>
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
            </div> : <ThemeWorkbench signals={enriched} latestDate={latestDate} activeTheme={theme} onThemeChange={chooseTheme} />}
          </section>
        </div>
      </main>
    </>
  );
}
