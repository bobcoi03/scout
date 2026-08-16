import { ScoutHeader } from "@/components/scout-header";

export default function TableLoading() {
  return <main className="flex h-dvh flex-col overflow-hidden bg-[#eeebe5] text-[#181818]">
    <ScoutHeader active="table" />
    <section className="mx-auto flex min-h-0 w-full max-w-[1800px] flex-1 animate-pulse flex-col px-5 pb-5 pt-7 sm:px-8">
      <div className="h-3 w-28 rounded-full bg-[#181818]/10" /><div className="mt-4 h-10 w-[min(520px,80vw)] rounded-xl bg-[#181818]/10" /><div className="mt-3 h-4 w-[520px] max-w-full rounded-full bg-[#181818]/10" />
      <div className="mt-8 min-h-0 flex-1 overflow-hidden rounded-2xl border border-[#181818]/15">{Array.from({ length: 9 }, (_, index) => <div key={index} className="grid min-w-[1800px] grid-cols-[150px_180px_180px_240px_420px_260px_260px] gap-5 border-b border-[#181818]/10 px-5 py-5 last:border-0"><i className="h-3 rounded-full bg-[#181818]/9" /><i className="h-5 rounded-full bg-[#181818]/9" /><i className="h-5 rounded-full bg-[#181818]/9" /><i className="h-5 rounded-full bg-[#181818]/9" /><i className="h-5 rounded-full bg-[#181818]/9" /><i className="h-4 rounded-full bg-[#181818]/9" /><i className="h-4 rounded-full bg-[#181818]/9" /></div>)}</div>
    </section>
  </main>;
}
