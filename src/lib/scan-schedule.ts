const DAY_MS = 86_400_000;
const MAX_RETRY_DELAY_MS = 15 * 60_000;

export function shiftUtcDay(day: string, amount: number) {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + amount * DAY_MS).toISOString().slice(0, 10);
}

export function dailyScanWindow(now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  const finalDay = shiftUtcDay(today, -1);
  return {
    finalDay,
    catchupFrom: shiftUtcDay(finalDay, -6),
  };
}

function rateLimitResetSeconds(error: unknown) {
  const visited = new Set<unknown>();
  let current: unknown = error;

  while (current && !visited.has(current)) {
    visited.add(current);
    if (typeof current === "object") {
      const candidate = current as {
        response?: { headers?: { get?: (name: string) => string | null } };
        cause?: unknown;
        message?: unknown;
      };
      const header = candidate.response?.headers?.get?.("x-rate-limit-reset");
      if (header && /^\d+$/.test(header)) return Number(header);
      if (typeof candidate.message === "string") {
        const match = candidate.message.match(/x-rate-limit-reset[=:\s]+(\d+)/i);
        if (match) return Number(match[1]);
      }
      current = candidate.cause;
      continue;
    }
    break;
  }

  return null;
}

export function scanRetryDelayMs(error: unknown, attempt: number, now = Date.now()) {
  const fallback = Math.max(30_000, attempt * 30_000);
  const resetSeconds = rateLimitResetSeconds(error);
  if (!resetSeconds) return fallback;
  const untilReset = resetSeconds * 1_000 - now + 5_000;
  return Math.min(MAX_RETRY_DELAY_MS, Math.max(fallback, untilReset));
}
