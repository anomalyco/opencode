// Browser-compatible glob shim using VFS
import { _vfs_listAll } from "./fs.browser"

function minimatchSimple(filepath: string, pattern: string): boolean {
  // Convert glob pattern to regex
  let regex = pattern
    .replace(/\./g, "\\.")
    .replace(/\*\*/g, "{{GLOBSTAR}}")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    .replace(/{{GLOBSTAR}}/g, ".*")

  // Handle leading slash
  if (!regex.startsWith("/")) {
    regex = ".*/" + regex
  }

  try {
    return new RegExp("^" + regex + "$").test(filepath)
  } catch {
    return false
  }
}

export class Glob {
  private pattern: string
  private opts: any

  constructor(pattern: string, opts?: any) {
    this.pattern = pattern
    this.opts = opts || {}
  }

  async *[Symbol.asyncIterator]() {
    const allFiles = _vfs_listAll()
    for (const [filepath] of allFiles) {
      if (minimatchSimple(filepath, this.pattern)) {
        yield filepath
      }
    }
  }

  static scan(pattern: string, _opts?: any): AsyncIterable<string> {
    const glob = new Glob(pattern)
    return glob
  }
}

export function glob(pattern: string, opts?: any): Promise<string[]> {
  return globSync(pattern, opts) as any
}

export function globSync(pattern: string, _opts?: any): string[] {
  const allFiles = _vfs_listAll()
  const results: string[] = []
  for (const [filepath] of allFiles) {
    if (minimatchSimple(filepath, pattern)) {
      results.push(filepath)
    }
  }
  return results
}

export default glob
