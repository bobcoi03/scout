import type { FeedPost } from "@/db";
import { listProjectRows, updateFeedPostExternalUrls } from "@/db";
import { env } from "@/lib/env";
import { getXProfile, getXThreadExternalUrls, resolvePostExternalUrls } from "@/lib/x-session";

function normalized(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export async function enrichCandidateProjectUrls(posts: FeedPost[]) {
  const selected = posts.filter((post) => post.externalUrls.length === 0).slice(0, env.candidateLinkEnrichmentLimit);
  const enriched = new Map<string, string[]>();

  for (let index = 0; index < selected.length; index += 3) {
    await Promise.all(selected.slice(index, index + 3).map(async (post) => {
      try {
        const threadUrls = await getXThreadExternalUrls(post.id, post.username, post.externalUrls);
        if (threadUrls.length) {
          updateFeedPostExternalUrls(post.id, threadUrls);
          enriched.set(post.id, threadUrls);
          return;
        }

        const profile = await getXProfile(post.username);
        const profileValues = [profile.website, profile.url].filter((value): value is string => Boolean(value));
        if (!profileValues.length) return;
        const candidates = await resolvePostExternalUrls(profile.biography ?? "", profileValues);
        const linkInBio = /\blink in (?:my |the )?bio\b/i.test(post.text);
        const selectedUrl = linkInBio ? candidates[0] : candidates.length === 1 ? candidates[0] : null;
        if (!selectedUrl) return;
        updateFeedPostExternalUrls(post.id, [selectedUrl]);
        enriched.set(post.id, [selectedUrl]);
      } catch {
        // Link recovery improves recall but must never make the daily scan fail.
      }
    }));
  }

  return {
    posts: posts.map((post) => enriched.has(post.id) ? { ...post, externalUrls: enriched.get(post.id)! } : post),
    checked: selected.length,
    updated: enriched.size,
  };
}

export async function enrichCuratedProjectUrls(from: string, to: string) {
  const rows = listProjectRows(from, to, 5000, "curated").filter((row) => !row.projectUrl);
  let updated = 0;

  for (let index = 0; index < rows.length; index += 3) {
    await Promise.all(rows.slice(index, index + 3).map(async (row) => {
      try {
        const threadUrls = await getXThreadExternalUrls(row.postId, row.username, row.externalUrls);
        if (threadUrls.length) {
          updateFeedPostExternalUrls(row.postId, threadUrls);
          updated += 1;
          return;
        }

        const profile = await getXProfile(row.username);
        const profileValues = [profile.website, profile.url].filter((value): value is string => Boolean(value));
        const profileText = [...profileValues, profile.biography].filter((value): value is string => Boolean(value)).join(" ");
        if (!profileText) return;
        const candidates = await resolvePostExternalUrls(profileText, profileValues);
        const projectTokens = row.projectName.toLowerCase().split(/[^a-z0-9]+/)
          .filter((token) => token.length >= 5 && !["project", "source", "application"].includes(token));
        const biography = normalized(profile.biography ?? "");
        const linkInBio = /\blink in (?:my |the )?bio\b/i.test(row.postText);
        const selected = candidates.find((candidate) => {
          const urlText = normalized(candidate);
          return linkInBio || projectTokens.some((token) => urlText.includes(token) || biography.includes(token));
        });
        if (!selected) return;
        updateFeedPostExternalUrls(row.postId, [selected]);
        updated += 1;
      } catch {
        // Missing/rate-limited threads and profiles should not fail a scan.
      }
    }));
  }

  const remaining = listProjectRows(from, to, 5000, "curated").filter((row) => !row.projectUrl).length;
  return { checked: rows.length, updated, remaining };
}
