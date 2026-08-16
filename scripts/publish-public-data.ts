import { loadEnvConfig } from "@next/env";
import { put } from "@vercel/blob";
import fs from "node:fs/promises";
import path from "node:path";

loadEnvConfig(process.cwd());

const datasetPath = path.resolve(process.cwd(), "src", "data", "public-dataset.json");

async function pause(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const token = process.env.BLOB_READ_WRITE_TOKEN?.trim();
  if (!token) throw new Error("BLOB_READ_WRITE_TOKEN is not configured");
  const body = await fs.readFile(datasetPath);

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const blob = await put("scout/dataset.json", body, {
        access: "public",
        addRandomSuffix: false,
        allowOverwrite: true,
        cacheControlMaxAge: 300,
        contentType: "application/json",
        token,
      });
      console.log(`Published Scout dataset to ${blob.url}.`);
      return;
    } catch (error) {
      if (attempt === 3) throw error;
      const delayMs = attempt * 15_000;
      console.error(`Dataset publish attempt ${attempt}/3 failed; retrying in ${delayMs / 1000}s.`);
      await pause(delayMs);
    }
  }
}

void main();
