import type { Metadata } from "next";

import { type ThemeName, themeOrder } from "@/components/product-intelligence";
import { ProductWorkspace } from "@/components/product-workspace";

export const metadata: Metadata = {
  title: "Scout Intelligence — Product concept",
  description: "A visual market-intelligence view of the launches Scout has verified.",
};

export default async function ProductPage({ searchParams }: PageProps<"/product">) {
  const requestedTheme = (await searchParams).theme;
  const initialTheme = typeof requestedTheme === "string" && themeOrder.includes(requestedTheme as ThemeName)
    ? requestedTheme as ThemeName
    : "All themes";
  return <ProductWorkspace initialView="Signals" initialTheme={initialTheme} />;
}
