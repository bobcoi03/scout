import { listPublishedProjectRows } from "@/lib/public-dataset";

function validDay(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : null;
}

function csvCell(value: string) {
  const spreadsheetSafe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${spreadsheetSafe.replaceAll('"', '""')}"`;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const from = validDay(url.searchParams.get("from"));
  const to = validDay(url.searchParams.get("to"));
  if (!from || !to || from > to) return new Response("Invalid date range", { status: 400 });
  const rows = await listPublishedProjectRows(from, to);
  const header = ["Published At (UTC)", "X Handle", "Project", "Description", "Project URL", "Discovery Post"];
  const lines = [header, ...rows.map((row) => [
    new Date(row.date).toISOString(), `@${row.username}`, row.projectName,
    row.description ?? "", row.projectUrl ?? "", row.discoveryUrl,
  ])].map((row) => row.map((cell) => csvCell(String(cell))).join(","));
  return new Response(`\uFEFF${lines.join("\r\n")}\r\n`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="scout-builders-${from}-to-${to}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
