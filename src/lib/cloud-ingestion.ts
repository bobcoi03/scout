import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createReadStream, createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { createGunzip, createGzip } from "node:zlib";

import { del, get, head, put } from "@vercel/blob";

import { dailyScanWindow } from "@/lib/scan-schedule";

const statePathname = "scout/state.sqlite.gz";
const lockPathname = "scout/locks/daily-ingestion.json";
const staleLockMs = 2 * 60 * 60_000;

type CloudState = {
  etag: string;
  compressedBytes: number;
};

function requiredEnvironment(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

async function acquireLock(token: string, runId: string) {
  const body = JSON.stringify({ runId, startedAt: new Date().toISOString() });
  const create = () => put(lockPathname, body, {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: false,
    cacheControlMaxAge: 60,
    contentType: "application/json",
    token,
  });

  try {
    await create();
    return true;
  } catch (initialError) {
    const existing = await head(lockPathname, { token }).catch(() => null);
    if (existing && Date.now() - existing.uploadedAt.getTime() < staleLockMs) return false;
    if (existing) await del(lockPathname, { token });
    try {
      await create();
      return true;
    } catch (retryError) {
      const racedLock = await head(lockPathname, { token }).catch(() => null);
      if (racedLock && Date.now() - racedLock.uploadedAt.getTime() < staleLockMs) return false;
      throw new AggregateError([initialError, retryError], "Could not acquire the private ingestion lock");
    }
  }
}

async function restoreState(databasePath: string, compressedPath: string, token: string): Promise<CloudState> {
  const state = await get(statePathname, { access: "private", token, useCache: false });
  if (!state || state.statusCode !== 200 || !state.stream) {
    throw new Error("The private Scout ingestion state is missing");
  }

  const compressed = Buffer.from(await new Response(state.stream).arrayBuffer());
  await fs.writeFile(compressedPath, compressed);
  await pipeline(createReadStream(compressedPath), createGunzip(), createWriteStream(databasePath));
  return { etag: state.blob.etag, compressedBytes: compressed.byteLength };
}

async function persistState(databasePath: string, compressedPath: string, token: string, etag: string) {
  await pipeline(createReadStream(databasePath), createGzip({ level: 6 }), createWriteStream(compressedPath));
  const body = await fs.readFile(compressedPath);
  const state = await put(statePathname, body, {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 60,
    contentType: "application/gzip",
    ifMatch: etag,
    token,
  });
  return { etag: state.etag, compressedBytes: body.byteLength };
}

export async function runCloudDailyIngestion() {
  const stateToken = requiredEnvironment("SCOUT_STATE_READ_WRITE_TOKEN");
  requiredEnvironment("BLOB_READ_WRITE_TOKEN");
  requiredEnvironment("OAI_API_KEY");
  requiredEnvironment("X_AUTH_TOKEN");
  requiredEnvironment("X_CT0");
  if (process.env.X_SCRAPING_ENABLED?.trim().toLowerCase() !== "true") {
    throw new Error("X_SCRAPING_ENABLED must be true for cloud ingestion");
  }

  const runId = randomUUID();
  if (!await acquireLock(stateToken, runId)) {
    return { status: "already-running" as const, runId };
  }

  const runRoot = await fs.mkdtemp(path.join(os.tmpdir(), "scout-ingestion-"));
  const databasePath = path.join(runRoot, "scout.db");
  const compressedPath = path.join(runRoot, "state.sqlite.gz");
  process.env.SCOUT_DB_PATH = databasePath;
  process.env.SCOUT_RUNTIME_DATA_DIR = path.join(runRoot, "data");

  let restored: CloudState | null = null;
  let statePersisted = false;
  try {
    restored = await restoreState(databasePath, compressedPath, stateToken);
    const { catchupFrom, finalDay } = dailyScanWindow();
    console.log(`Scout cloud update ${runId}: checking ${catchupFrom} through ${finalDay}.`);

    const [{ runBackfill }, { buildPublicDataset }, db, { publishPublicDataset }] = await Promise.all([
      import("@/lib/backfill-runner"),
      import("@/lib/public-export"),
      import("@/db"),
      import("@/lib/public-publisher"),
    ]);
    const summary = await runBackfill({ from: catchupFrom, to: finalDay, delayMs: 5_000 });
    const dataset = await buildPublicDataset();
    db.closeDatabase();

    const saved = await persistState(databasePath, compressedPath, stateToken, restored.etag);
    statePersisted = true;
    const published = await publishPublicDataset(`${JSON.stringify(dataset)}\n`);
    console.log(`Scout cloud update ${runId}: published ${dataset.rows.length} rows through ${finalDay}.`);

    return {
      status: "completed" as const,
      runId,
      window: { from: catchupFrom, to: finalDay },
      summary,
      dataset: { rows: dataset.rows.length, generatedAt: dataset.generatedAt, url: published.url },
      state: { restoredBytes: restored.compressedBytes, savedBytes: saved.compressedBytes },
    };
  } catch (error) {
    if (restored && !statePersisted) {
      try {
        const db = await import("@/db");
        db.closeDatabase();
        await persistState(databasePath, compressedPath, stateToken, restored.etag);
      } catch (stateError) {
        console.error("Could not persist failed-run state:", stateError);
      }
    }
    throw error;
  } finally {
    await del(lockPathname, { token: stateToken }).catch((error) => console.error("Could not release ingestion lock:", error));
    await fs.rm(runRoot, { recursive: true, force: true });
  }
}
