import { loadEnvConfig } from "@next/env";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

import { dailyScanWindow } from "../src/lib/scan-schedule";

loadEnvConfig(process.cwd());

const lockPath = path.resolve(process.cwd(), "data", ".daily-scan.lock");

function processIsRunning(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function acquireLock() {
  await fs.mkdir(path.dirname(lockPath), { recursive: true });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await fs.open(lockPath, "wx");
      await handle.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
      return async () => {
        await handle.close();
        await fs.unlink(lockPath).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOENT") throw error;
        });
      };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") throw error;

      const existing: { pid?: number } = await fs.readFile(lockPath, "utf8")
        .then((value) => JSON.parse(value) as { pid?: number })
        .catch(() => ({}));
      if (typeof existing.pid === "number" && processIsRunning(existing.pid)) return null;
      await fs.unlink(lockPath).catch((unlinkError: NodeJS.ErrnoException) => {
        if (unlinkError.code !== "ENOENT") throw unlinkError;
      });
    }
  }

  return null;
}

async function runNpm(args: string[]) {
  const npmCli = process.env.npm_execpath;
  if (!npmCli) throw new Error("npm_execpath is unavailable; run this task through npm run scan:daily");

  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [npmCli, ...args], {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`npm ${args.join(" ")} exited with ${code ?? signal ?? "unknown status"}`));
    });
  });
}

async function main() {
  const releaseLock = await acquireLock();
  if (!releaseLock) {
    console.log("Scout daily update is already running; nothing to do.");
    return;
  }

  try {
    const { catchupFrom, finalDay } = dailyScanWindow();
    console.log(`Scout daily update: checking ${catchupFrom} through ${finalDay}; completed days will be skipped.`);
    await runNpm([
      "run",
      "backfill",
      "--",
      "--from",
      catchupFrom,
      "--to",
      finalDay,
      "--delay-ms",
      "5000",
    ]);
    await runNpm(["run", "publish:public"]);
  } finally {
    await releaseLock();
  }
}

void main();
