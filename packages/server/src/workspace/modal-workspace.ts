import { WorkspaceDriver } from "@opencode-ai/core/workspace/driver"
import { makeGlobalNode } from "@opencode-ai/util/effect/app-node"
import { Effect, Layer } from "effect"
import type { Image, ModalClient, ModalClientParams, Sandbox } from "modal"
import { createModalSandboxWithClient, makeModalDriver, type ModalImageSpec } from "./modal"

export interface ModalWorkspaceOptions {
  readonly app: string
  readonly client?: ModalClientParams
  readonly image?: ModalImageSpec
}

export const modalWorkspaceDriver = (options: ModalWorkspaceOptions): WorkspaceDriver.Interface => {
  const name = (workspaceID: string) => `ws-${workspaceID}`

  const openClient = Effect.tryPromise({
    try: async () => {
      const { ModalClient } = await import("modal")
      return new ModalClient(options.client)
    },
    catch: (cause) => new WorkspaceDriver.Error({ cause }),
  })

  const attempt = <A>(run: () => Promise<A>) =>
    Effect.tryPromise({ try: run, catch: (cause) => new WorkspaceDriver.Error({ cause }) })

  const useClient = <A, E>(run: (client: ModalClient) => Effect.Effect<A, E>) =>
    Effect.acquireUseRelease(openClient, run, (client) => Effect.sync(() => client.close()))

  const findLive = async (client: ModalClient, binding: WorkspaceDriver.Binding, workspaceID?: string) => {
    const { NotFoundError } = await import("modal")
    if (typeof binding.sandboxId === "string") {
      const sandbox = await client.sandboxes.fromId(binding.sandboxId).catch((error) => {
        if (error instanceof NotFoundError) return undefined
        throw error
      })
      if (sandbox && (await sandbox.poll()) === null) return sandbox
    }
    if (!workspaceID || typeof binding.snapshotImageId === "string") return
    const sandbox = await client.sandboxes.fromName(options.app, name(workspaceID)).catch((error) => {
      if (error instanceof NotFoundError) return undefined
      throw error
    })
    if (sandbox && (await sandbox.poll()) === null) return sandbox
  }

  const createSandbox = async (client: ModalClient, workspaceID: string, image?: Image) => {
    const { AlreadyExistsError } = await import("modal")
    return createModalSandboxWithClient(
      client,
      {
        app: options.app,
        client: options.client,
        image: options.image,
        sandbox: {
          name: name(workspaceID),
          tags: { workspace: workspaceID },
          timeoutMs: 24 * 60 * 60 * 1000,
        },
      },
      image,
    ).catch((error) => {
      if (error instanceof AlreadyExistsError) return client.sandboxes.fromName(options.app, name(workspaceID))
      throw error
    })
  }

  const deleteImage = (client: ModalClient, imageID: unknown) =>
    typeof imageID === "string" ? attempt(() => client.images.delete(imageID)).pipe(Effect.ignore) : Effect.void

  const terminate = (sandbox: Sandbox | undefined) =>
    sandbox ? attempt(() => sandbox.terminate({ wait: true })).pipe(Effect.ignore) : Effect.void

  return WorkspaceDriver.make({
    create: ({ workspaceID }) =>
      useClient((client) =>
        attempt(async () => {
          const sandbox = await createSandbox(client, workspaceID)
          return { binding: { sandboxId: sandbox.sandboxId } }
        }),
      ),
    connect: ({ workspaceID, binding, saveBinding }) =>
      Effect.acquireRelease(openClient, (client) => Effect.sync(() => client.close())).pipe(
        Effect.flatMap((client) =>
          Effect.gen(function* () {
            const sandbox = yield* attempt(async () => {
              const existing = await findLive(client, binding, workspaceID)
              const image =
                existing || typeof binding.snapshotImageId !== "string"
                  ? undefined
                  : await client.images.fromId(binding.snapshotImageId)
              return existing ?? createSandbox(client, workspaceID, image)
            })
            if (binding.sandboxId !== sandbox.sandboxId) {
              yield* saveBinding({
                sandboxId: sandbox.sandboxId,
                ...(typeof binding.snapshotImageId === "string" ? { snapshotImageId: binding.snapshotImageId } : {}),
              })
            }
            return makeModalDriver(sandbox)
          }),
        ),
      ),
    suspendForIdle: ({ binding, saveBinding }) =>
      useClient((client) =>
        Effect.gen(function* () {
          const sandbox = yield* attempt(() => findLive(client, binding))
          if (!sandbox) return
          const snapshot = yield* attempt(() => sandbox.snapshotFilesystem({ ttlMs: null }))
          yield* saveBinding({ snapshotImageId: snapshot.imageId })
          yield* deleteImage(client, binding.snapshotImageId)
          yield* terminate(sandbox)
        }),
      ),
    destroy: ({ binding }) =>
      useClient((client) =>
        Effect.gen(function* () {
          const sandbox = yield* attempt(() => findLive(client, binding))
          yield* terminate(sandbox)
          yield* deleteImage(client, binding.snapshotImageId)
        }),
      ),
  })
}

export const modalWorkspaceRegistryNode = (options: ModalWorkspaceOptions) =>
  makeGlobalNode({
    service: WorkspaceDriver.RegistryService,
    layer: Layer.succeed(
      WorkspaceDriver.RegistryService,
      WorkspaceDriver.RegistryService.of(WorkspaceDriver.registry({ modal: modalWorkspaceDriver(options) })),
    ),
    deps: [],
  })
