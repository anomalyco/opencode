/** Worktree stub — browser agent doesn't use git worktrees */
export namespace Worktree {
  export async function create(_opts: any): Promise<any> {
    throw new Error("Worktree operations not available in browser agent")
  }
  export async function remove(_opts: any): Promise<void> {}
  export async function list(): Promise<any[]> { return [] }
}
