import path from "node:path";

export function scoutDataPath(...segments: string[]) {
  const configuredRoot = process.env.SCOUT_RUNTIME_DATA_DIR?.trim();
  const root = configuredRoot ? path.resolve(configuredRoot) : path.resolve(process.cwd(), "data");
  return path.join(root, ...segments);
}
