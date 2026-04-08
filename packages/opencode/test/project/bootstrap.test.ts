import { afterEach, expect, mock, spyOn, test } from "bun:test"
import { Bus } from "../../src/bus"
import { Command } from "../../src/command"
import { File } from "../../src/file"
import { FileWatcher } from "../../src/file/watcher"
import { Format } from "../../src/format"
import { LSP } from "../../src/lsp"
import { Plugin } from "../../src/plugin"
import { InstanceBootstrap } from "../../src/project/bootstrap"
import { Instance } from "../../src/project/instance"
import { Project } from "../../src/project/project"
import { Vcs } from "../../src/project/vcs"
import { MessageID, SessionID } from "../../src/session/schema"
import { ShareNext } from "../../src/share/share-next"
import { Snapshot } from "../../src/snapshot"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await resetDatabase()
})

test("InstanceBootstrap captures project id for command handler and unsubscribes on reload", async () => {
  await using tmp = await tmpdir()
  const unsub = mock(() => {})
  type Executed = {
    type: typeof Command.Event.Executed.type
    properties: {
      name: string
      sessionID: SessionID
      arguments: string
      messageID: MessageID
    }
  }
  let cb: ((event: Executed) => unknown) | undefined
  const sub = spyOn(Bus, "subscribe").mockImplementation((_def, fn) => {
    cb = fn as (event: Executed) => unknown
    return unsub
  })
  const set = spyOn(Project, "setInitialized").mockImplementation(() => undefined)
  const share = spyOn(ShareNext, "init").mockResolvedValue(undefined)
  const plugin = spyOn(Plugin, "init").mockResolvedValue(undefined)
  const lsp = spyOn(LSP, "init").mockImplementation(async () => ({
    broken: new Set<string>(),
    servers: {},
    clients: [],
    spawning: new Map(),
  }))
  const format = spyOn(Format, "init").mockImplementation(async () => undefined)
  const file = spyOn(File, "init").mockImplementation(async () => undefined)
  const watcher = spyOn(FileWatcher, "init").mockImplementation(async () => undefined)
  const vcs = spyOn(Vcs, "init").mockImplementation(async () => undefined)
  const snapshot = spyOn(Snapshot, "init").mockImplementation(async () => undefined)

  try {
    const id = await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await InstanceBootstrap()
        return Instance.project.id
      },
    })

    expect(sub).toHaveBeenCalledTimes(1)
    expect(unsub).toHaveBeenCalledTimes(0)
    expect(cb).toBeDefined()

    await Promise.resolve(
      cb?.({
        type: Command.Event.Executed.type,
        properties: {
          name: Command.Default.INIT,
          sessionID: SessionID.make("ses_test"),
          arguments: "",
          messageID: MessageID.ascending(),
        },
      }),
    )

    expect(set).toHaveBeenCalledWith(id)

    await Instance.reload({ directory: tmp.path })

    expect(unsub).toHaveBeenCalledTimes(1)
  } finally {
    snapshot.mockRestore()
    vcs.mockRestore()
    watcher.mockRestore()
    file.mockRestore()
    format.mockRestore()
    lsp.mockRestore()
    plugin.mockRestore()
    share.mockRestore()
    set.mockRestore()
    sub.mockRestore()
  }
})
