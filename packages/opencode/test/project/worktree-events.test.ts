import { describe, expect, test } from "bun:test"
import { $ } from "bun"
import path from "path"
import { Bus } from "../../src/bus"
import { GlobalBus } from "../../src/bus/global"
import { Instance } from "../../src/project/instance"
import { Worktree } from "../../src/worktree"
import { tmpdir } from "../fixture/fixture"

function collectGlobal() {
  const events: { directory?: string; payload: any }[] = []
  const listener = (data: { directory?: string; payload: any }) => {
    events.push(data)
  }
  GlobalBus.on("event", listener)
  return {
    events,
    cleanup: () => GlobalBus.removeListener("event", listener),
  }
}

function collectBus() {
  const events: { type: string; properties: any }[] = []
  const cleanup = Bus.subscribeAll((event) => {
    events.push(event)
  })
  return { events, cleanup }
}

describe("Worktree events", () => {
  test("worktree.created reaches both Bus and GlobalBus", async () => {
    await using tmp = await tmpdir({ git: true })
    const global = collectGlobal()
    try {
      const info = await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const bus = collectBus()
          try {
            const result = await Worktree.create(undefined)

            const event = bus.events.find((e) => e.type === "worktree.created")
            expect(event).toBeDefined()
            expect(event!.properties.info.name).toBe(result.name)
            expect(event!.properties.info.branch).toBe(result.branch)
            expect(event!.properties.info.directory).toBe(result.directory)

            return result
          } finally {
            bus.cleanup()
          }
        },
      })

      const event = global.events.find((e) => e.payload.type === "worktree.created")
      expect(event).toBeDefined()
      expect(event!.payload.properties.info.directory).toBe(info.directory)
    } finally {
      global.cleanup()
    }
  })

  test("worktree.removed reaches both Bus and GlobalBus", async () => {
    await using tmp = await tmpdir({ git: true })
    const name = `event-remove-${Date.now().toString(36)}`
    const branch = `opencode/${name}`
    const dir = path.join(tmp.path, "..", name)

    await $`git worktree add --no-checkout -b ${branch} ${dir}`.cwd(tmp.path).quiet()
    await $`git reset --hard`.cwd(dir).quiet()

    const global = collectGlobal()
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const bus = collectBus()
          try {
            await Worktree.remove({ directory: dir })

            const event = bus.events.find((e) => e.type === "worktree.removed")
            expect(event).toBeDefined()
            expect(event!.properties.directory).toBeTruthy()
          } finally {
            bus.cleanup()
          }
        },
      })

      const event = global.events.find((e) => e.payload.type === "worktree.removed")
      expect(event).toBeDefined()
      expect(event!.directory).toBe(tmp.path)
    } finally {
      global.cleanup()
    }
  })

  test("worktree.reset reaches both Bus and GlobalBus", async () => {
    await using tmp = await tmpdir({ git: true })
    const name = `event-reset-${Date.now().toString(36)}`
    const branch = `opencode/${name}`
    const dir = path.join(tmp.path, "..", name)

    await $`git worktree add --no-checkout -b ${branch} ${dir}`.cwd(tmp.path).quiet()
    await $`git reset --hard`.cwd(dir).quiet()

    const global = collectGlobal()
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const bus = collectBus()
          try {
            await Worktree.reset({ directory: dir })

            const event = bus.events.find((e) => e.type === "worktree.reset")
            expect(event).toBeDefined()
            expect(event!.properties.directory).toBeTruthy()
          } finally {
            bus.cleanup()
          }
        },
      })

      const event = global.events.find((e) => e.payload.type === "worktree.reset")
      expect(event).toBeDefined()
    } finally {
      global.cleanup()
    }
  })
})
