import { Download } from "lucide-react";

import { ScoutHeader } from "@/components/scout-header";
import { TableExplorer } from "@/components/table-explorer";
import { listPublishedProjectRows } from "@/lib/public-dataset";

function one(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function validDay(value: string | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : null;
}

export default async function TablePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const today = new Date().toISOString().slice(0, 10);
  const allRows = await listPublishedProjectRows("1970-01-01", today);
  const firstPublishedDay = allRows.length
    ? new Date(Math.min(...allRows.map((row) => row.date))).toISOString().slice(0, 10)
    : today;
  const to = validDay(one(params.to)) ?? today;
  const requestedFrom = validDay(one(params.from)) ?? firstPublishedDay;
  const from = requestedFrom <= to ? requestedFrom : to;
  const rowCount = from === firstPublishedDay && to === today
    ? allRows.length
    : (await listPublishedProjectRows(from, to)).length;
  const exportUrl = `/api/export?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;

  return <main className="flex h-dvh flex-col overflow-hidden bg-[#eeebe5] text-[#181818]">
    <ScoutHeader active="table" indexHref="/product" tableHref="/table">
      <a href={exportUrl} className="inline-flex h-10 items-center gap-2 rounded-full border border-[#e42313] px-4 text-xs font-medium transition hover:bg-[#e42313] hover:text-white"><Download className="h-3.5 w-3.5" />Export CSV</a>
    </ScoutHeader>

    <section className="mx-auto flex min-h-0 w-full max-w-[1800px] flex-1 flex-col px-5 pb-5 pt-7 sm:px-8">
      <div className="flex shrink-0 flex-col justify-between gap-5 border-b border-[#181818]/20 pb-6 lg:flex-row lg:items-end">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-[#e42313]">Builder dataset</p>
          <h1 className="mt-2 font-serif text-3xl tracking-[-0.04em] sm:text-5xl">Everything we know.</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[#181818]/55">{rowCount} unique curated projects from {from} through {to}, ready for outreach.</p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <form method="get" className="flex flex-wrap items-end gap-2">
            <label className="grid gap-1.5 text-[9px] uppercase tracking-[0.14em] text-[#181818]/45">From<input type="date" name="from" defaultValue={from} max={to} className="h-10 rounded-full border border-[#181818]/25 bg-transparent px-3 text-xs text-[#181818] outline-none focus:border-[#e42313]" /></label>
            <label className="grid gap-1.5 text-[9px] uppercase tracking-[0.14em] text-[#181818]/45">To<input type="date" name="to" defaultValue={to} max={today} className="h-10 rounded-full border border-[#181818]/25 bg-transparent px-3 text-xs text-[#181818] outline-none focus:border-[#e42313]" /></label>
            <button type="submit" className="h-10 rounded-full bg-[#181818] px-5 text-xs font-medium text-[#eeebe5] transition hover:bg-[#e42313]">Apply</button>
          </form>
        </div>
      </div>

      <TableExplorer from={from} to={to} />
    </section>
  </main>;
}
