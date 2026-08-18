import { loadEnvConfig } from "@next/env";
import fs from "node:fs/promises";
import path from "node:path";

import { publishPublicDataset } from "../src/lib/public-publisher";

loadEnvConfig(process.cwd());

const datasetPath = path.resolve(process.cwd(), "src", "data", "public-dataset.json");

async function main() {
  const body = await fs.readFile(datasetPath);
  const blob = await publishPublicDataset(body);
  console.log(`Published Scout dataset to ${blob.url}.`);
}

void main();
