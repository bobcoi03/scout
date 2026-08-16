import type { Metadata } from "next";

import { ProductIntelligence, type IntelligenceSignal } from "@/components/product-intelligence";
import { listPublishedProjectRows } from "@/lib/public-dataset";

export const metadata: Metadata = {
  title: "Scout Intelligence — Product concept",
  description: "A visual market-intelligence view of the launches Scout has verified.",
};

function safeMediaUrl(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === "pbs.twimg.com" || url.hostname.endsWith(".twimg.com"))
      ? url.href
      : null;
  } catch {
    return null;
  }
}

export default async function ProductPage() {
  const today = new Date().toISOString().slice(0, 10);
  const rows = await listPublishedProjectRows("1970-01-01", today);
  const signals: IntelligenceSignal[] = rows.map((row) => ({
    id: row.postId,
    date: row.date,
    category: row.category,
    signalType: row.signalType,
    builderName: row.builderName,
    username: row.username,
    projectName: row.projectName,
    projectUrl: row.projectUrl,
    discoveryUrl: row.discoveryUrl,
    description: row.description,
    postText: row.postText,
    mediaUrl: safeMediaUrl(row.mediaUrl),
    analystScore: row.analystScore,
    confidence: row.confidence,
    likes: row.likes,
    reposts: row.reposts,
    replies: row.replies,
    views: row.views,
  }));

  const dates = signals.map((signal) => signal.date);
  const from = dates.length ? new Date(Math.min(...dates)).toISOString().slice(0, 10) : today;
  const to = dates.length ? new Date(Math.max(...dates)).toISOString().slice(0, 10) : today;

  return <ProductIntelligence signals={signals} from={from} to={to} />;
}
