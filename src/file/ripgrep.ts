/**
 * Ripgrep stub — browser agent doesn't search code files.
 * Kept as no-op to avoid breaking imports.
 */
export namespace Ripgrep {
  export async function search(_opts: { pattern: string; cwd: string; limit?: number }): Promise<string[]> {
    return []
  }

  export async function tree(_opts: { cwd: string; limit?: number }): Promise<string> {
    return ""
  }

  export async function files(_opts: { cwd: string; limit?: number }): Promise<string[]> {
    return []
  }
}
