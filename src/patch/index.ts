/** Patch stub — browser agent doesn't apply code patches */
export namespace Patch {
  export function apply(_content: string, _patch: string): string {
    throw new Error("Patch operations not available in browser agent")
  }
  export function parse(_input: string) {
    return []
  }
}
