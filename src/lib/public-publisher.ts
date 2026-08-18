import { put } from "@vercel/blob";

async function pause(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function publishPublicDataset(body: string | Buffer, token = process.env.BLOB_READ_WRITE_TOKEN?.trim()) {
  if (!token) throw new Error("BLOB_READ_WRITE_TOKEN is not configured");

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await put("scout/dataset.json", body, {
        access: "public",
        addRandomSuffix: false,
        allowOverwrite: true,
        cacheControlMaxAge: 300,
        contentType: "application/json",
        token,
      });
    } catch (error) {
      if (attempt === 3) throw error;
      const delayMs = attempt * 15_000;
      console.error(`Dataset publish attempt ${attempt}/3 failed; retrying in ${delayMs / 1000}s.`);
      await pause(delayMs);
    }
  }

  throw new Error("Dataset publish failed");
}
