"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { finishFeedScan, listPostsForAnalysis, startFeedScan, upsertFeedPosts } from "@/db";
import { xSessionConfigured } from "@/lib/env";
import { enrichCandidateProjectUrls } from "@/lib/project-url-enrichment";
import { runProductionReview } from "@/lib/production-review";
import { scanXFeed } from "@/lib/x-session";

function requestedDay(formData: FormData) {
  const value = String(formData.get("day") ?? "").trim();
  const parsed = new Date(`${value}T00:00:00.000Z`);
  const today = new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value || value > today) return null;
  return value;
}

export async function refreshFeedAction(formData: FormData) {
  if (!xSessionConfigured()) redirect("/?scan=not-configured");

  const day = requestedDay(formData);
  if (!day) redirect("/?scan=invalid-date");

  const scanId = startFeedScan(day);
  let destination = `/?scan=error&day=${day}`;
  let stage: "x" | "analysis" | "enrichment" = "x";
  try {
    const { posts, supersededIds, candidateCount } = await scanXFeed(day);
    upsertFeedPosts(posts, supersededIds);
    stage = "enrichment";
    const enrichment = await enrichCandidateProjectUrls(listPostsForAnalysis(day));
    stage = "analysis";
    const review = await runProductionReview(enrichment.posts);
    finishFeedScan(scanId, { status: "completed", foundCount: candidateCount, savedCount: review.published });
    destination = `/?scan=complete&found=${review.published}&day=${day}`;
  } catch (error) {
    finishFeedScan(scanId, {
      status: "failed",
      error: error instanceof Error ? error.message.slice(0, 500) : "Unknown X scan error",
    });
    destination = `/?scan=${stage}-error&day=${day}`;
  }

  revalidatePath("/");
  redirect(destination);
}
