import { loadEnvConfig } from "@next/env";
import { writePublicDataset } from "../src/lib/public-export";

loadEnvConfig(process.cwd());

async function main() {
  const dataset = await writePublicDataset();
  console.log(`Exported ${dataset.rows.length} curated launches to src/data/public-dataset.json.`);
}

void main();
