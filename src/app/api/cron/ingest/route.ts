import { hasValidCronAuthorization } from "@/lib/cron-auth";
import { runCloudDailyIngestion } from "@/lib/cloud-ingestion";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 1800;

export async function GET(request: Request) {
  if (!hasValidCronAuthorization(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    return Response.json(await runCloudDailyIngestion());
  } catch (error) {
    const message = error instanceof Error ? error.message : "Cloud ingestion failed";
    console.error("Scout cloud ingestion failed:", error);
    return Response.json({ error: message }, { status: 500 });
  }
}
