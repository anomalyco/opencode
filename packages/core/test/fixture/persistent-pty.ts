import { Effect, Layer } from "effect"
import { PersistentPty } from "@opencode/core/persistent-pty"

// No process daemon: shell commands fall back to the Environment's spawner, and nothing is ever running in it.
export const disabledPersistentPtyLayer = Layer.mock(PersistentPty.Service, {
  createPipe: () => Effect.fail(new PersistentPty.UnavailableError({ message: "process daemon disabled" })),
  listPipes: () => Effect.succeed([]),
  handoffPrepared: () => false,
})
