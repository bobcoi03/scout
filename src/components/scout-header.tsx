import type { ReactNode } from "react";

import { RepositoryLink } from "@/components/repository-link";
import { ScoutBrand } from "@/components/scout-brand";
import { ViewNav } from "@/components/view-nav";

export function ScoutHeader({
  active,
  indexHref = "/product",
  tableHref = "/table",
  fixed = false,
  children,
}: {
  active: "index" | "table";
  indexHref?: string;
  tableHref?: string;
  fixed?: boolean;
  children?: ReactNode;
}) {
  return <header className={`${fixed ? "fixed inset-x-0 top-0" : "relative"} z-40 shrink-0 border-b border-[#181818]/20 bg-[#eeebe5]/95 backdrop-blur-xl`}>
    <div className="mx-auto flex h-[76px] max-w-7xl items-center justify-between gap-5 px-5 sm:px-8">
      <div className="flex items-center gap-5">
        <ScoutBrand />
        <ViewNav active={active} indexHref={indexHref} tableHref={tableHref} />
      </div>
      <div className="flex items-center gap-3 sm:gap-5">
        {children}
        <RepositoryLink className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-[#181818]/20 text-[#181818]/65 transition hover:border-[#181818]/40 hover:text-[#181818] [&>svg]:h-4 [&>svg]:w-4" />
      </div>
    </div>
  </header>;
}
