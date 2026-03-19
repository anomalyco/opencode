import { $ } from "bun"
import { Identifier } from "@/id/id"
import { fn } from "@/util/fn"
import { Log } from "@/util/log"
import { Instance } from "@/project/instance"
import { Vcs } from "@/project/vcs"
import { Session } from "."

export namespace SessionVersion {
  const log = Log.create({ service: "session.version" })

  const decoder = new TextDecoder()

  const branchName = (sessionID: string) => `numeral/${sessionID}`

  const text = (input: Uint8Array | undefined) => decoder.decode(input ?? new Uint8Array()).trim()

  async function currentBranch() {
    const result = await $`git rev-parse --abbrev-ref HEAD`.quiet().nothrow().cwd(Instance.worktree)
    if (result.exitCode !== 0) return
    const value = text(result.stdout)
    if (!value || value === "HEAD") return
    return value
  }

  async function currentHead() {
    const result = await $`git rev-parse HEAD`.quiet().nothrow().cwd(Instance.worktree)
    if (result.exitCode !== 0) return
    return text(result.stdout)
  }

  async function dirty() {
    const result = await $`git status --porcelain=v1 --untracked-files=all`.quiet().nothrow().cwd(Instance.worktree)
    if (result.exitCode !== 0) return false
    return text(result.stdout).length > 0
  }

  async function all() {
    const result = [] as Session.Info[]
    for await (const item of Session.list()) {
      result.push(item)
    }
    return result
  }

  function familyFrom(list: Session.Info[], sessionID: string) {
    const byID = new Map(list.map((item) => [item.id, item]))
    const first = byID.get(sessionID)
    if (!first) return [] as Session.Info[]

    let root = first
    while (root.parentID) {
      const parent = byID.get(root.parentID)
      if (!parent) break
      root = parent
    }

    const byParent = new Map<string, Session.Info[]>()
    for (const item of list) {
      if (!item.parentID) continue
      const prev = byParent.get(item.parentID)
      if (prev) {
        prev.push(item)
        continue
      }
      byParent.set(item.parentID, [item])
    }

    const result = [] as Session.Info[]
    const stack = [root]
    while (stack.length) {
      const item = stack.shift()
      if (!item) continue
      result.push(item)
      const children = (byParent.get(item.id) ?? []).toSorted((a, b) => {
        if (a.time.created !== b.time.created) return a.time.created - b.time.created
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
      })
      stack.push(...children)
    }

    return result.toSorted((a, b) => {
      if (a.time.created !== b.time.created) return a.time.created - b.time.created
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    })
  }

  async function hydrate(sessionID: string) {
    const family = familyFrom(await all(), sessionID)
    const latest = family[family.length - 1]
    const root = family[0]
    if (!latest || !root) return family

    await Promise.all(
      family.map((item, index) => {
        const next = {
          rootID: root.id,
          latestID: latest.id,
          number: index + 1,
        }
        if (
          item.lineage?.rootID === next.rootID &&
          item.lineage.latestID === next.latestID &&
          item.lineage.number === next.number
        ) {
          return
        }
        return Session.update(
          item.id,
          (draft) => {
            draft.lineage = next
          },
          { touch: item.id === root.id },
        )
      }),
    )

    return family.map((item, index) => ({
      ...item,
      lineage: {
        rootID: root.id,
        latestID: latest.id,
        number: index + 1,
      },
    }))
  }

  async function sessionForBranch(branch: string) {
    return (await all()).find((item) => item.git?.branch === branch)
  }

  async function ensure(sessionID: string) {
    const session = await Session.get(sessionID)
    if (session.git?.branch) return session
    const branch = await currentBranch()
    if (!branch) return session
    const head = await currentHead()
    return Session.update(
      sessionID,
      (draft) => {
        draft.git = {
          branch,
          head,
          saved_at: draft.git?.saved_at,
        }
      },
      { touch: false },
    )
  }

  async function commit(session: Session.Info) {
    const add = await $`git add -A`.quiet().nothrow().cwd(Instance.worktree)
    if (add.exitCode !== 0) {
      throw new Error(text(add.stderr) || text(add.stdout) || "Failed to stage version changes")
    }
    const result = await $`git commit -m ${`numeral: save version ${session.id}`}`
      .quiet()
      .nothrow()
      .cwd(Instance.worktree)
    if (result.exitCode !== 0) {
      throw new Error(text(result.stderr) || text(result.stdout) || "Failed to save version")
    }
  }

  export const save = fn(Identifier.schema("session"), async (sessionID) => {
    if (Instance.project.vcs !== "git") return Session.get(sessionID)
    const session = await ensure(sessionID)
    const branch = session.git?.branch ?? (await currentBranch())
    if (!branch) return session
    const active = await currentBranch()
    if (active && session.git?.branch && active !== session.git.branch) {
      return session
    }
    if (await dirty()) {
      await commit(session)
    }
    const head = await currentHead()
    return Session.update(
      session.id,
      (draft) => {
        draft.git = {
          branch,
          head,
          saved_at: Date.now(),
        }
      },
      { touch: false },
    )
  })

  export const create = fn(Identifier.schema("session"), async (sessionID) => {
    if (Instance.project.vcs !== "git") return Session.fork({ sessionID })
    await hydrate(sessionID)
    const parent = await ensure(sessionID)
    await save(sessionID)
    const child = await Session.fork({ sessionID })
    await Session.update(
      child.id,
      (draft) => {
        draft.title = parent.title
      },
      { touch: false },
    )

    const branch = branchName(child.id)
    const result = await $`git checkout -b ${branch}`.quiet().nothrow().cwd(Instance.worktree)
    if (result.exitCode !== 0) {
      throw new Error(text(result.stderr) || text(result.stdout) || "Failed to create version")
    }
    await Vcs.refresh()
    const head = await currentHead()
    await Session.update(
      child.id,
      (draft) => {
        draft.git = {
          branch,
          head,
          saved_at: Date.now(),
        }
      },
      { touch: false },
    )
    await hydrate(child.id)
    return Session.get(child.id)
  })

  export const select = fn(Identifier.schema("session"), async (sessionID) => {
    if (Instance.project.vcs !== "git") return Session.get(sessionID)
    await hydrate(sessionID)
    const target = await ensure(sessionID)
    const next = target.git?.branch
    if (!next) return target

    const current = await currentBranch()
    if (current && current !== next) {
      const active = await sessionForBranch(current)
      if (active) {
        await save(active.id)
      } else if (await dirty()) {
        throw new Error("Could not save the current version")
      }
    }

    if (current !== next) {
      const result = await $`git checkout ${next}`.quiet().nothrow().cwd(Instance.worktree)
      if (result.exitCode !== 0) {
        throw new Error(text(result.stderr) || text(result.stdout) || "Failed to open version")
      }
      await Vcs.refresh()
    }

    const head = await currentHead()
    return Session.update(
      target.id,
      (draft) => {
        draft.git = {
          branch: next,
          head,
          saved_at: draft.git?.saved_at,
        }
      },
      { touch: false },
    )
  })

  export const family = fn(Identifier.schema("session"), async (sessionID) => {
    const result = await hydrate(sessionID)
    log.info("family", { sessionID, size: result.length })
    return result
  })
}
