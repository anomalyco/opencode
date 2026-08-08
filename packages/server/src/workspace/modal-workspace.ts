import { WorkspaceDriver } from "@opencode-ai/core/workspace/driver"
import { Effect, Option, Schema } from "effect"
import type { App, Image, ModalClient, ModalClientParams, Sandbox } from "modal"
import { createModalSandboxWithClient, makeModalDriver, type ModalImageSpec, openModalClient } from "./modal"

export const provider = "modal"

export const ModalBinding = Schema.Struct({
  sandboxId: Schema.optional(Schema.String),
  snapshotImageId: Schema.optional(Schema.String),
})
export type ModalBinding = typeof ModalBinding.Type

export interface ModalWorkspaceOptions {
  readonly app: string
  readonly client?: ModalClientParams
  readonly image?: ModalImageSpec
}

export const modalWorkspaceDriver = (options: ModalWorkspaceOptions): WorkspaceDriver.Interface => {
  const decodeBinding = Schema.decodeUnknownOption(ModalBinding)
  let clientPromise: Promise<ModalClient> | undefined
  let appPromise: Promise<App> | undefined
  // The SDK client and app handle are shared for the process lifetime of this driver.
  const client = () => (clientPromise ??= openModalClient(options.client))
  const app = () =>
    (appPromise ??= client().then((value) => value.apps.fromName(options.app, { createIfMissing: true })))

  const attempt = <A>(run: () => Promise<A>) =>
    Effect.tryPromise({ try: run, catch: (cause) => new WorkspaceDriver.Error({ cause }) })

  const binding = (value: WorkspaceDriver.Binding): ModalBinding => Option.getOrElse(decodeBinding(value), () => ({}))

  const live = async (lookup: () => Promise<Sandbox>) => {
    const { NotFoundError } = await import("modal")
    const sandbox = await lookup().catch((error) => {
      if (error instanceof NotFoundError) return undefined
      throw error
    })
    if (sandbox && (await sandbox.poll()) === null) return sandbox
  }

  const findLive = async (modalClient: ModalClient, value: ModalBinding, workspaceID: string) => {
    if (value.sandboxId) {
      const sandboxID = value.sandboxId
      const sandbox = await live(() => modalClient.sandboxes.fromId(sandboxID))
      if (sandbox) return sandbox
    }
    // Name fallback is valid only before the first snapshot; afterward a live named sandbox is stale by design.
    if (value.snapshotImageId) return
    return live(() => modalClient.sandboxes.fromName(options.app, workspaceID))
  }

  const createSandbox = async (workspaceID: string, image?: Image) => {
    const { AlreadyExistsError } = await import("modal")
    const modalClient = await client()
    return createModalSandboxWithClient(
      modalClient,
      await app(),
      {
        image: options.image,
        sandbox: {
          name: workspaceID,
          tags: { workspace: workspaceID },
          timeoutMs: 24 * 60 * 60 * 1000,
        },
      },
      image,
    ).catch((error) => {
      if (error instanceof AlreadyExistsError) return modalClient.sandboxes.fromName(options.app, workspaceID)
      throw error
    })
  }

  const deleteImage = (modalClient: ModalClient, imageID?: string) =>
    imageID ? attempt(() => modalClient.images.delete(imageID)).pipe(Effect.ignore) : Effect.void

  const terminate = (sandbox?: Sandbox) =>
    sandbox ? attempt(() => sandbox.terminate({ wait: true })).pipe(Effect.ignore) : Effect.void

  return WorkspaceDriver.make({
    create: ({ workspaceID }) =>
      attempt(async () => {
        const sandbox = await createSandbox(workspaceID)
        return { binding: { sandboxId: sandbox.sandboxId } }
      }),
    connect: ({ workspaceID, binding: value, saveBinding }) =>
      Effect.gen(function* () {
        const modalBinding = binding(value)
        const modalClient = yield* attempt(client)
        const sandbox = yield* attempt(async () => {
          const existing = await findLive(modalClient, modalBinding, workspaceID)
          const image =
            existing || !modalBinding.snapshotImageId
              ? undefined
              : await modalClient.images.fromId(modalBinding.snapshotImageId)
          return existing ?? createSandbox(workspaceID, image)
        })
        if (modalBinding.sandboxId !== sandbox.sandboxId) {
          yield* saveBinding({ ...modalBinding, sandboxId: sandbox.sandboxId })
        }
        return makeModalDriver(sandbox)
      }),
    suspendForIdle: ({ workspaceID, binding: value, saveBinding }) =>
      Effect.gen(function* () {
        const modalBinding = binding(value)
        const modalClient = yield* attempt(client)
        const sandbox = yield* attempt(() => findLive(modalClient, modalBinding, workspaceID))
        if (!sandbox) return
        const snapshot = yield* attempt(() => sandbox.snapshotFilesystem({ ttlMs: null }))
        yield* saveBinding({ snapshotImageId: snapshot.imageId })
        yield* Effect.all([deleteImage(modalClient, modalBinding.snapshotImageId), terminate(sandbox)], {
          concurrency: "unbounded",
          discard: true,
        })
      }),
    destroy: ({ workspaceID, binding: value }) =>
      Effect.gen(function* () {
        const modalBinding = binding(value)
        const modalClient = yield* attempt(client)
        const sandbox = yield* attempt(() => findLive(modalClient, modalBinding, workspaceID))
        yield* Effect.all([terminate(sandbox), deleteImage(modalClient, modalBinding.snapshotImageId)], {
          concurrency: "unbounded",
          discard: true,
        })
      }),
  })
}
