export function displayProjectName(value: string) {
  return value.replace(/_+/g, " ").replace(/\s+/g, " ").trim();
}
