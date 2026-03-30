/**
 * Worktree stub — browser agent doesn't use git worktrees.
 * Exports Zod schemas and method stubs so server routes + control-plane compile.
 */
import z from "zod"

export namespace Worktree {
  export const Info = z.object({
    directory: z.string(),
    branch: z.string().optional(),
    name: z.string().optional(),
  })
  export type Info = z.infer<typeof Info>

  export const CreateInput = z.object({
    branch: z.string().optional(),
    directory: z.string().optional(),
  })
  export type CreateInput = z.infer<typeof CreateInput>

  export const RemoveInput = z.object({
    directory: z.string(),
  })
  export type RemoveInput = z.infer<typeof RemoveInput>

  export const ResetInput = z.object({
    directory: z.string(),
  })
  export type ResetInput = z.infer<typeof ResetInput>

  export async function create(_opts?: CreateInput): Promise<Info> {
    throw new Error("Worktree operations not available in browser agent")
  }

  export async function remove(_opts: RemoveInput): Promise<void> {
    throw new Error("Worktree operations not available in browser agent")
  }

  export async function reset(_opts: ResetInput): Promise<void> {
    throw new Error("Worktree operations not available in browser agent")
  }

  export async function list(): Promise<string[]> {
    return []
  }

  export async function makeWorktreeInfo(_name?: string): Promise<{ name: string; branch: string; directory: string }> {
    throw new Error("Worktree operations not available in browser agent")
  }

  export async function createFromInfo(_opts: { name: string; directory: string; branch: string }): Promise<void> {
    throw new Error("Worktree operations not available in browser agent")
  }
}
