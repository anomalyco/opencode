import type { MiddlewareHandler } from "hono"
import { Instance } from "@/project/instance"
import { InstanceBootstrap } from "@/project/bootstrap"
import { AppRuntime } from "@/effect/app-runtime"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { WorkspaceContext } from "@/control-plane/workspace-context"
import { WorkspaceID } from "@/control-plane/schema"
import { MultiRootWorkspace } from "@/workspace"
import { MultiRootWorkspaceID } from "@/workspace/schema"
import { Log } from "@/util"
import { Schema } from "effect"

const log = Log.create({ service: "server.middleware" })

const MULTI_ROOT_HEADER = "x-opencode-multiroot-workspace"

function safeDecode(raw: string): string {
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

/**
 * Resolve the multi-root workspace referenced by the `x-opencode-multiroot-workspace`
 * header into an absolute folder list. Returns `undefined` when no workspace is
 * referenced or when the workspace cannot be opened (caller falls back to
 * single-root behavior).
 */
async function resolveMultiRoot(id: string): Promise<
  | {
      id: MultiRootWorkspaceID
      folders: string[]
    }
  | undefined
> {
  try {
    const workspaceID = Schema.decodeUnknownSync(MultiRootWorkspaceID)(id)
    const info = await AppRuntime.runPromise(MultiRootWorkspace.Service.use((svc) => svc.open(workspaceID)))
    if (!info) return undefined
    const folders: string[] = []
    for (const folder of info.folders) {
      try {
        folders.push(AppFileSystem.resolve(folder.path))
      } catch (error) {
        log.warn("skipping invalid folder path", { id, path: folder.path, error })
      }
    }
    if (folders.length === 0) return undefined
    return { id: workspaceID, folders }
  } catch (error) {
    log.warn("failed to resolve multi-root workspace", { id, error })
    return undefined
  }
}

export function InstanceMiddleware(workspaceID?: WorkspaceID): MiddlewareHandler {
  return async (c, next) => {
    const explicitDirectory = c.req.query("directory") || c.req.header("x-opencode-directory")
    const multiRootRaw = c.req.query("multiRootWorkspace") || c.req.header(MULTI_ROOT_HEADER)

    const multiRoot = multiRootRaw ? await resolveMultiRoot(multiRootRaw) : undefined

    const rawDirectory = explicitDirectory ?? multiRoot?.folders[0] ?? process.cwd()
    const directory = AppFileSystem.resolve(safeDecode(rawDirectory))

    // When a multi-root workspace is resolved, build the roots list. If the
    // explicit directory is one of the workspace folders, keep it as the
    // primary directory (so tools default cwd matches the user's intent).
    // Otherwise fall back to the first workspace folder as the primary.
    let roots: string[] | undefined
    let multiRootWorkspaceID: MultiRootWorkspaceID | undefined
    let primary = directory
    if (multiRoot) {
      const folderSet = new Set(multiRoot.folders)
      if (!folderSet.has(directory)) {
        primary = multiRoot.folders[0]
      }
      roots = [primary, ...multiRoot.folders.filter((p) => p !== primary)]
      multiRootWorkspaceID = multiRoot.id
    }

    return WorkspaceContext.provide({
      workspaceID,
      async fn() {
        return Instance.provide({
          directory: primary,
          roots,
          multiRootWorkspaceID,
          init: () => AppRuntime.runPromise(InstanceBootstrap),
          async fn() {
            return next()
          },
        })
      },
    })
  }
}
