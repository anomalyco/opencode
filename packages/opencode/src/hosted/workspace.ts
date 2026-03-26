import { Identifier } from "@/id/id"
import { Storage } from "@/storage/storage"
import { validateWorkspace } from "@/project/workspace"
import { Flag } from "@/flag/flag"
import { Filesystem } from "@/util/filesystem"
import { Project } from "@/project/project"
import path from "path"
import z from "zod"

export namespace HostedWorkspace {
  export const Info = z
    .object({
      id: Identifier.schema("workspace"),
      name: z.string(),
      path: z.string(),
      project_id: z.string(),
      enabled: z.boolean(),
      created_by: Identifier.schema("user"),
      time: z.object({
        created: z.number(),
        updated: z.number(),
      }),
    })
    .meta({
      ref: "HostedWorkspace",
    })
  export type Info = z.output<typeof Info>

  function clean(name: string, target: string) {
    const value = name.trim()
    if (value) return value
    return path.basename(target) || target
  }

  export function root() {
    const value = Flag.OPENCODE_WORKSPACES_ROOT
    if (!value) return
    return path.resolve(value)
  }

  async function resolved(target: string) {
    return path.resolve(target)
  }

  async function assertPath(target: string) {
    const rootDir = root()
    if (!rootDir) {
      return {
        ok: false as const,
        reason: "OPENCODE_WORKSPACES_ROOT is not configured",
      }
    }

    const next = await resolved(target)
    if (!Filesystem.contains(rootDir, next)) {
      return {
        ok: false as const,
        reason: "Workspace path must be inside OPENCODE_WORKSPACES_ROOT",
      }
    }

    const checked = await validateWorkspace(next)
    if (!checked.valid) {
      return {
        ok: false as const,
        reason: checked.reason,
      }
    }

    return {
      ok: true as const,
      path: checked.directory,
    }
  }

  async function all() {
    const keys = await Storage.list(["hosted_workspace"])
    const workspaces = await Promise.all(keys.map((key) => Storage.read<Info>(key).catch(() => undefined)))
    return workspaces
      .filter((workspace): workspace is Info => !!workspace)
      .sort((a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path))
  }

  export async function list(input?: { enabled?: boolean }) {
    const workspaces = await all()
    if (input?.enabled === undefined) return workspaces
    return workspaces.filter((workspace) => workspace.enabled === input.enabled)
  }

  export async function get(workspaceID: string) {
    return Storage.read<Info>(["hosted_workspace", workspaceID]).catch(() => undefined)
  }

  export async function byPath(target: string) {
    const next = await resolved(target)
    const workspaces = await all()
    return workspaces.find((workspace) => workspace.path === next)
  }

  export async function create(input: { name?: string; path: string; created_by: string }) {
    const checked = await assertPath(input.path)
    if (!checked.ok) throw new Error(checked.reason)

    const existing = await byPath(checked.path)
    if (existing) return existing

    const project = await Project.fromDirectory(checked.path)
    const now = Date.now()
    const workspace: Info = {
      id: Identifier.ascending("workspace"),
      name: clean(input.name ?? "", checked.path),
      path: checked.path,
      project_id: project.project.id,
      enabled: true,
      created_by: Identifier.schema("user").parse(input.created_by),
      time: {
        created: now,
        updated: now,
      },
    }
    await Storage.write(["hosted_workspace", workspace.id], workspace)
    return workspace
  }

  export async function update(input: { workspaceID: string; name?: string; enabled?: boolean }) {
    return Storage.update<Info>(["hosted_workspace", input.workspaceID], (draft) => {
      if (input.name !== undefined) draft.name = clean(input.name, draft.path)
      if (input.enabled !== undefined) draft.enabled = input.enabled
      draft.time.updated = Date.now()
    })
  }

  export async function allowed(target: string) {
    const workspace = await byPath(target)
    if (!workspace?.enabled) return
    return workspace
  }
}
