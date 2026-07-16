import * as path from "path"

export function alwaysPattern(relativePath: string): string[] {
  const dir = path.dirname(relativePath)
  return dir === "." ? ["*"] : [path.join(dir, "*")]
}
