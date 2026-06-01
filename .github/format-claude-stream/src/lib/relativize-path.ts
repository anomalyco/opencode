import * as path from "path";

/**
 * Returns a path relative to `cwd` if the path is under `cwd`; otherwise
 * returns the original path unchanged.
 */
export function relativizePath(
    cwd: string | undefined,
    filePath: string,
): string {
    if (!cwd || !filePath) return filePath;
    const rel = path.relative(cwd, filePath);
    if (rel.startsWith("..")) return filePath;
    return rel || ".";
}
