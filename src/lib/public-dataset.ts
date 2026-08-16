import bundledDataset from "@/data/public-dataset.json";

export type PublicProjectRow = {
  postId: string;
  date: number;
  category: string;
  builderName: string;
  username: string;
  projectName: string;
  projectUrl: string | null;
  description: string | null;
  discoveryUrl: string;
  postText: string;
  mediaUrl: string | null;
  likes: number;
  reposts: number;
  replies: number;
  views: number;
  signalType: string;
  analystScore: number;
  confidence: number;
};

export type PublicDataset = {
  version: 1;
  generatedAt: string;
  rows: PublicProjectRow[];
};

function isPublicDataset(value: unknown): value is PublicDataset {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PublicDataset>;
  return candidate.version === 1 && typeof candidate.generatedAt === "string" && Array.isArray(candidate.rows);
}

async function fetchPublishedDataset() {
  const dataUrl = process.env.SCOUT_DATA_URL?.trim();
  if (!dataUrl) return null;

  try {
    const response = await fetch(dataUrl, { next: { revalidate: 300, tags: ["scout-dataset"] } });
    if (!response.ok) throw new Error(`Dataset request failed with ${response.status}`);
    const dataset: unknown = await response.json();
    return isPublicDataset(dataset) ? dataset : null;
  } catch (error) {
    console.error("Could not fetch the published Scout dataset; using the bundled snapshot.", error);
    return null;
  }
}

export async function getPublicDataset(): Promise<PublicDataset> {
  return (await fetchPublishedDataset()) ?? bundledDataset as PublicDataset;
}

export async function listPublishedProjectRows(from: string, to: string, limit = 5000) {
  const start = Date.parse(`${from}T00:00:00.000Z`);
  const inclusiveEnd = Date.parse(`${to}T00:00:00.000Z`);
  if (!Number.isFinite(start) || !Number.isFinite(inclusiveEnd) || start > inclusiveEnd) {
    throw new Error("Invalid project date range");
  }
  const end = inclusiveEnd + 86_400_000;
  const { rows } = await getPublicDataset();
  return rows.filter((row) => row.date >= start && row.date < end).slice(0, limit);
}
