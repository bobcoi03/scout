"use client";

import { ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";

import { displayProjectName } from "@/lib/project-name";

type TableRow = {
  date: number;
  username: string;
  projectName: string;
  description: string | null;
  projectUrl: string | null;
  discoveryUrl: string;
};

function displayDate(value: number) {
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(value);
}

export function TableExplorer({ from, to }: { from: string; to: string }) {
  const [rows, setRows] = useState<TableRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/table-data?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(await response.text());
        return response.json() as Promise<{ rows: TableRow[] }>;
      })
      .then((result) => setRows(result.rows))
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load the dataset.");
      });
    return () => controller.abort();
  }, [from, to]);

  if (error) return <div className="mt-5 border-y border-[#e42313] px-6 py-12 text-center text-sm text-[#e42313]">{error}</div>;
  if (!rows) return <div className="mt-5 min-h-0 flex-1 animate-pulse overflow-hidden border-y border-[#181818]/15">{Array.from({ length: 7 }, (_, index) => <div key={index} className="grid grid-cols-[160px_190px_210px_1fr_270px_270px] gap-0 border-b border-[#181818]/10">{Array.from({ length: 6 }, (__, cell) => <i key={cell} className="m-4 h-4 rounded-full bg-[#181818]/9" />)}</div>)}</div>;
  if (!rows.length) return <div className="mt-5 border-y border-dashed border-[#181818]/25 px-6 py-20 text-center"><p className="font-serif text-3xl">No curated projects yet.</p><p className="mt-3 text-sm text-[#181818]/50">The table fills in as reviewed projects are accepted.</p></div>;

  return <div data-testid="table-scroll" className="mt-5 min-h-0 flex-1 overflow-auto overscroll-contain border-y border-[#181818]/25">
    <table className="w-full min-w-[1420px] table-fixed border-separate border-spacing-0 text-left text-[11px] leading-5">
      <thead className="sticky top-0 z-20 bg-[#dedad3] shadow-[0_1px_0_rgba(24,24,24,0.28)]"><tr className="text-[9px] uppercase tracking-[0.13em] text-[#181818]/55 [&>th]:border-r [&>th]:border-[#181818]/10 [&>th]:px-3 [&>th]:py-3 [&>th]:font-medium [&>th]:whitespace-nowrap [&>th:last-child]:border-r-0">
        <th className="sticky left-0 z-30 w-40 bg-[#dedad3]">Published (UTC)</th>
        <th className="sticky left-40 z-30 w-[190px] bg-[#dedad3] shadow-[5px_0_10px_-8px_rgba(24,24,24,0.8)]">X handle</th>
        <th className="w-[210px]">Project</th>
        <th className="w-[480px]">Description</th>
        <th className="w-[270px]">Project URL</th>
        <th className="w-[270px]">Discovery post</th>
      </tr></thead>
      <tbody>{rows.map((row) => <tr key={row.discoveryUrl} className="h-[82px] align-top odd:bg-[#f7f4ee] even:bg-[#f0ede7] hover:bg-[#e8e4dd] [&>td]:border-b [&>td]:border-r [&>td]:border-[#181818]/10 [&>td]:px-3 [&>td]:py-2.5 [&>td:last-child]:border-r-0">
        <td className="sticky left-0 z-10 whitespace-nowrap bg-inherit font-mono text-[10px] text-[#181818]/50">{displayDate(row.date)}</td>
        <td className="sticky left-40 z-10 bg-inherit shadow-[5px_0_10px_-8px_rgba(24,24,24,0.8)]"><a href={`https://x.com/${row.username}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-[#e42313] hover:text-[#181818]">@{row.username}<ExternalLink className="h-3 w-3 shrink-0" /></a></td>
        <td className="font-medium capitalize"><div className="data-cell-scroll max-h-[60px] overflow-y-auto pr-1">{displayProjectName(row.projectName)}</div></td>
        <td className="text-[#181818]/70"><div title={row.description ?? undefined} className="data-cell-scroll max-h-[60px] overflow-y-auto pr-1">{row.description ?? "—"}</div></td>
        <td className="break-all"><div className="data-cell-scroll max-h-[60px] overflow-y-auto pr-1">{row.projectUrl ? <a href={row.projectUrl} target="_blank" rel="noreferrer" className="text-[#e42313] hover:text-[#181818]">{row.projectUrl}</a> : <span className="text-[#181818]/30">—</span>}</div></td>
        <td className="break-all"><div className="data-cell-scroll max-h-[60px] overflow-y-auto pr-1"><a href={row.discoveryUrl} target="_blank" rel="noreferrer" className="text-[#e42313] hover:text-[#181818]">{row.discoveryUrl}</a></div></td>
      </tr>)}</tbody>
    </table>
  </div>;
}
