type ExploreForkResponse<T> = Promise<{ data?: T; error?: unknown }>

export type ExploreForkTarget =
  | {
      type: "create"
    }
  | {
      type: "current"
      directory: string
    }
  | {
      type: "existing"
      directory: string
    }

export type ExploreForkClient = {
  session: {
    fork(input: { sessionID: string; messageID?: string }): ExploreForkResponse<{ id: string }>
  }
  worktree: {
    create(input: { directory: string }): ExploreForkResponse<{ directory?: string; branch?: string }>
  }
  vcs: {
    diff2: {
      raw(): ExploreForkResponse<string>
    }
    apply(input: { patch: string }): ExploreForkResponse<{ applied?: boolean }>
  }
}

export type ExploreForkWorktreeState =
  | {
      status: "ready"
    }
  | {
      status: "failed"
      message: string
    }

export class ExploreForkError extends Error {
  constructor(
    readonly kind: "worktree" | "copy" | "fork",
    message: string,
  ) {
    super(message)
  }
}

export async function runExploreFork(input: {
  client: ExploreForkClient
  sourceDirectory: string
  sessionID: string
  target: ExploreForkTarget
  createClient: (directory: string) => ExploreForkClient
  markWorktreePending: (directory: string) => void
  waitForWorktree: (directory: string) => Promise<ExploreForkWorktreeState>
  syncChild: (directory: string) => void
  copyChanges?: boolean
}) {
  const targetDirectory =
    input.target.type === "create"
      ? await input.client.worktree
          .create({ directory: input.sourceDirectory })
          .then((result) => {
            if (result.error) throw new ExploreForkError("worktree", exploreForkErrorMessage(result.error))
            if (!result.data?.directory) throw new ExploreForkError("worktree", "Failed to create worktree")
            return result.data.directory
          })
          .catch((err) => {
            if (err instanceof ExploreForkError) throw err
            throw new ExploreForkError("worktree", exploreForkErrorMessage(err))
          })
      : input.target.directory

  const targetClient =
    targetDirectory === input.sourceDirectory ? input.client : input.createClient(targetDirectory)

  if (input.target.type === "create") {
    input.markWorktreePending(targetDirectory)
    const state = await input.waitForWorktree(targetDirectory)
    if (state.status === "failed") throw new ExploreForkError("worktree", state.message)
  }

  if (targetDirectory !== input.sourceDirectory) input.syncChild(targetDirectory)

  if ((input.copyChanges ?? true) && targetDirectory !== input.sourceDirectory) {
    const patch = await input.client.vcs.diff2
      .raw()
      .then((result) => {
        if (result.error) throw new ExploreForkError("copy", exploreForkErrorMessage(result.error))
        return result.data ?? ""
      })
      .catch((err) => {
        if (err instanceof ExploreForkError) throw err
        throw new ExploreForkError("copy", exploreForkErrorMessage(err))
      })
    if (patch.trim()) {
      const applied = await targetClient.vcs.apply({ patch }).catch((err) => {
        throw new ExploreForkError("copy", exploreForkErrorMessage(err))
      })
      if (applied.error) throw new ExploreForkError("copy", exploreForkErrorMessage(applied.error))
      if (applied.data?.applied === false) throw new ExploreForkError("copy", "Patch wasn't applied")
    }
  }

  const forked = await targetClient.session
    .fork({
      sessionID: input.sessionID,
    })
    .catch((err) => {
      throw new ExploreForkError("fork", exploreForkErrorMessage(err))
    })
  if (forked.error) throw new ExploreForkError("fork", exploreForkErrorMessage(forked.error))
  if (!forked.data?.id) throw new ExploreForkError("fork", "Failed to fork session")

  return {
    directory: targetDirectory,
    sessionID: forked.data.id,
  }
}

export function exploreForkErrorMessage(err: unknown) {
  if (err && typeof err === "object" && "data" in err) {
    const data = (err as { data?: { message?: string } }).data
    if (data?.message) return data.message
  }
  if (err instanceof Error) return err.message
  return String(err)
}
