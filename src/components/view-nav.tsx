import Link from "next/link";

export function ViewNav({ active, indexHref = "/product", tableHref = "/table" }: { active: "index" | "table"; indexHref?: string; tableHref?: string }) {
  const item = "rounded-full px-3 py-1.5 text-[10px] font-medium uppercase tracking-[0.12em] transition";
  return <nav aria-label="Scout views" className="flex items-center rounded-full border border-[#181818]/20 p-0.5">
    <Link href={indexHref} className={`${item} ${active === "index" ? "bg-[#181818] text-[#eeebe5]" : "text-[#181818]/50 hover:text-[#181818]"}`}>Index</Link>
    <Link href={tableHref} className={`${item} ${active === "table" ? "bg-[#181818] text-[#eeebe5]" : "text-[#181818]/50 hover:text-[#181818]"}`}>Dataset</Link>
  </nav>;
}
