/**
 * Ripgrep stub — browser agent doesn't search code files.
 * Exports Zod schemas and async generator stubs so server routes + tools compile.
 */
import z from "zod"

export namespace Ripgrep {
  export const Match = z.object({
    data: z.object({
      path: z.object({ text: z.string() }),
      lines: z.object({ text: z.string() }),
      line_number: z.number(),
      absolute_offset: z.number(),
      submatches: z.array(
        z.object({
          match: z.object({ text: z.string() }),
          start: z.number(),
          end: z.number(),
        }),
      ),
    }),
  })
  export type Match = z.infer<typeof Match>

  export async function search(_opts: any): Promise<Match[]> {
    return []
  }

  export async function tree(_opts: { cwd: string; limit?: number }): Promise<string> {
    return ""
  }

  export async function* files(_opts: any): AsyncGenerator<string> {
    // No-op — yields nothing
  }

  export async function filepath(): Promise<string> {
    return "rg" // Just return the name, won't be called
  }
}
