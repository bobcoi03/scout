import { listPublishedProjectRows } from "@/lib/public-dataset";

function validDay(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : null;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const from = validDay(url.searchParams.get("from"));
  const to = validDay(url.searchParams.get("to"));
  if (!from || !to || from > to) return Response.json({ error: "Invalid date range" }, { status: 400 });
  const rows = (await listPublishedProjectRows(from, to)).map((row) => ({
    date: row.date,
    username: row.username,
    projectName: row.projectName,
    description: row.description,
    projectUrl: row.projectUrl,
    discoveryUrl: row.discoveryUrl,
  }));
  return Response.json({ rows }, { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600" } });
}
