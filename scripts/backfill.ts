import { loadEnvConfig } from "@next/env";
import { runBackfill } from "../src/lib/backfill-runner";
import { shiftUtcDay } from "../src/lib/scan-schedule";

loadEnvConfig(process.cwd());

function arg(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function shiftDay(day: string, amount: number) {
  return shiftUtcDay(day, amount);
}

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  const requestedDays = Math.max(1, Math.min(90, Number(arg("--days") ?? 15) || 15));
  const from = arg("--from") ?? shiftDay(today, -(requestedDays - 1));
  const to = arg("--to") ?? today;
  const delayMs = Math.max(0, Math.min(60_000, Number(arg("--delay-ms") ?? 5_000) || 0));
  const force = process.argv.includes("--force");
  await runBackfill({ from, to, delayMs, force });
}

void main();
