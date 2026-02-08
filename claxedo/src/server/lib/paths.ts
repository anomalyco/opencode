/**
 * Path normalization utilities
 */

export function normalizeDirectory(input: string): string {
  const value = String(input || "").trim();
  if (!value) return value;
  return value.replace(/\/+$/, "");
}

export function directoryFrom(c: any): string {
  const header = c.req.header("x-opencode-directory");
  if (header) return normalizeDirectory(header);
  const query = c.req.query("directory");
  if (query) return normalizeDirectory(query);
  return "";
}
