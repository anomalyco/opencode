// Minimal minimatch shim for browser
export function minimatch(filepath: string, pattern: string, _opts?: any): boolean {
  let regex = pattern
    .replace(/\./g, "\\.")
    .replace(/\*\*/g, "{{GLOBSTAR}}")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    .replace(/{{GLOBSTAR}}/g, ".*")

  try {
    return new RegExp("^" + regex + "$").test(filepath)
  } catch {
    return false
  }
}

export class Minimatch {
  pattern: string
  constructor(pattern: string, _opts?: any) {
    this.pattern = pattern
  }
  match(filepath: string): boolean {
    return minimatch(filepath, this.pattern)
  }
}

export default minimatch
