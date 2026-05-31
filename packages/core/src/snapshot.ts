export namespace Snapshot {
  export type FileDiff = {
    file?: string
    patch?: string
    additions: number
    deletions: number
    status?: "added" | "deleted" | "modified"
  }
}
