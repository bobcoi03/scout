import type { Metadata } from "next";

import { ProductWorkspace } from "@/components/product-workspace";

export const metadata: Metadata = {
  title: "Market themes — Scout Intelligence",
  description: "Explore launch velocity, market themes, and the builders behind Scout's curated X signals.",
};

export default function ThemePage() {
  return <ProductWorkspace initialView="Themes" />;
}
