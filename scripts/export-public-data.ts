import { loadEnvConfig } from "@next/env";
import fs from "node:fs/promises";
import path from "node:path";

import type { PublicDataset, PublicProjectRow } from "../src/lib/public-dataset";

loadEnvConfig(process.cwd());

const outputPath = path.resolve(process.cwd(), "src", "data", "public-dataset.json");

async function main() {
  const { listProjectRows } = await import("../src/db");
  const rows = listProjectRows("1970-01-01", "9999-12-31", 5000, "curated");
  const publicRows: PublicProjectRow[] = rows.map((row) => ({
    postId: row.postId,
    date: row.date,
    category: row.category,
    builderName: row.builderName,
    username: row.username,
    projectName: row.projectName,
    projectUrl: row.projectUrl,
    description: row.description,
    discoveryUrl: row.discoveryUrl,
    postText: row.postText,
    mediaUrl: row.mediaUrl,
    likes: row.likes,
    reposts: row.reposts,
    replies: row.replies,
    views: row.views,
    signalType: row.signalType,
    analystScore: row.analystScore,
    confidence: row.confidence,
  }));
  const dataset: PublicDataset = {
    version: 1,
    generatedAt: new Date().toISOString(),
    rows: publicRows,
  };

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(dataset)}\n`);
  console.log(`Exported ${publicRows.length} curated launches to ${outputPath}.`);
}

void main();
