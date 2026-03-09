import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import path from "path"
import z from "zod"
import { Log } from "@/util/log"
import { Instance } from "./instance"
import { FileWatcher } from "@/file/watcher"
import { git } from "@/util/git"
import { Session } from "@/session"
import { Storage } from "@/storage/storage"
import { Snapshot } from "@/snapshot"

const log = Log.create({ service: "vcs" })

export namespace Vcs {
  export const Event = {
    BranchUpdated: BusEvent.define(
      "vcs.branch.updated",
      z.object({
        branch: z.string().optional(),
      }),
    ),
  }

  export const Info = z
    .object({
      branch: z.string(),
    })
    .meta({
      ref: "VcsInfo",
    })
  export type Info = z.infer<typeof Info>

  async function currentBranch() {
    const result = await git(["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: Instance.worktree,
    })
    if (result.exitCode !== 0) return
    const text = result.text().trim()
    if (!text) return
    return text
  }

  const state = Instance.state(
    async () => {
      if (Instance.project.vcs !== "git") {
        return {
          branch: async () => undefined,
          unsubscribe: undefined,
          unsubscribeGitStatus: undefined,
        }
      }
      let current = await currentBranch()
      log.info("initialized", { branch: current })

      const unsubscribe = Bus.subscribe(FileWatcher.Event.Updated, async (evt) => {
        if (evt.properties.file.endsWith("HEAD")) return
        const next = await currentBranch()
        if (next !== current) {
          log.info("branch changed", { from: current, to: next })
          current = next
          Bus.publish(Event.BranchUpdated, { branch: next })
        }
      })

      const unsubscribeGitStatus = Bus.subscribe(FileWatcher.Event.GitStatusChanged, async (evt) => {
        const directory = evt.properties.directory
        log.info("git status change", { directory: directory })

        const changedFiles = await Snapshot.diffFull("HEAD", "", path.join(directory, ".git"))
        const sessions = [...Session.list({ directory: directory })]
        for (const s of sessions) {
          try {
            await Storage.write(["session_diff", s.id], changedFiles)
            await Session.setSummary({
              sessionID: s.id,
              summary: {
                additions: changedFiles.reduce((sum, f) => sum + f.additions, 0),
                deletions: changedFiles.reduce((sum, f) => sum + f.deletions, 0),
                files: changedFiles.length,
              },
            })
            Bus.publish(Session.Event.Diff, { sessionID: s.id, diff: changedFiles })
          } catch (e) {
            log.error("failed to handle git status change", { 
              error: e,
              sessionID: s.id,
              directory: directory,
            })
          }
        }
      })

      return {
        branch: async () => current,
        unsubscribe,
        unsubscribeGitStatus,
      }
    },
    async (state) => {
      state.unsubscribe?.()
      state.unsubscribeGitStatus?.()
    },
  )

  export async function init() {
    return state()
  }

  export async function branch() {
    return await state().then((s) => s.branch())
  }
}
