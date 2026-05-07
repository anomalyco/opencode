import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Session } from "../../src/session"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { MessageID, PartID, type SessionID } from "../../src/session/schema"
import { SessionPrompt } from "../../src/session/prompt"
import { SessionRunState } from "../../src/session/run-state"
import { SessionPending } from "../../src/session/pending"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"
import { AppRuntime } from "../../src/effect/app-runtime"
import { Effect, Option } from "effect"

Log.init({ print: false })

afterEach(async () => {
  mock.restore()
  await Instance.disposeAll()
})

async function user(sessionID: SessionID, text: string) {
  const msg = await Session.updateMessage({
    id: MessageID.ascending(),
    role: "user",
    sessionID,
    agent: "build",
    model: { providerID: ProviderID.make("test"), modelID: ModelID.make("test") },
    time: { created: Date.now() },
  })
  await Session.updatePart({
    id: PartID.ascending(),
    sessionID,
    messageID: msg.id,
    type: "text",
    text,
  })
  return msg
}

function commandDraft(preview: string): SessionPending.Draft {
  return {
    kind: "command",
    preview,
    composer: {
      prompt: [],
      context: [],
    },
    request: {
      command: preview,
      arguments: "",
    },
  }
}

describe("session action routes", () => {
  test("abort route calls SessionPrompt.cancel", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const cancel = spyOn(SessionPrompt, "cancel").mockResolvedValue()
        const app = Server.Default().app
        const qs = `?directory=${encodeURIComponent(tmp.path)}`

        const res = await app.request(`/session/${session.id}/abort${qs}`, {
          method: "POST",
        })

        expect(res.status).toBe(200)
        expect(await res.json()).toBe(true)
        expect(cancel).toHaveBeenCalledWith(session.id)
        expect(
          await AppRuntime.runPromise(SessionPending.Service.use((svc) => svc.get(session.id))),
        ).toMatchObject({
          paused: false,
        })

        await Session.remove(session.id)
      },
    })
  })

  test("beginStop pauses pending delivery immediately", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        await AppRuntime.runPromise(
          SessionPending.Service.use((svc) =>
            svc.add({
              sessionID: session.id,
              lane: "queue",
              draft: {
                kind: "command",
                preview: "pwd",
                composer: {
                  prompt: [],
                  context: [],
                },
                request: {
                  command: "pwd",
                  arguments: "",
                },
              },
            }),
          ),
        )
        await AppRuntime.runPromise(SessionPending.Service.use((svc) => svc.beginStop(session.id)))
        expect(
          await AppRuntime.runPromise(SessionPending.Service.use((svc) => svc.get(session.id))),
        ).toMatchObject({
          paused: true,
          queue: [
            {
              draft: {
                preview: "pwd",
              },
            },
          ],
        })
        await Session.remove(session.id)
      },
    })
  })

  test("beginStop promotes steer items to the front of the queue in order", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        await AppRuntime.runPromise(SessionRunState.Service.use((svc) => svc.setPromptRunning(session.id, true)))
        for (const [lane, preview] of [
          ["steer", "steer1"],
          ["steer", "steer2"],
          ["queue", "queue1"],
        ] as const) {
          await AppRuntime.runPromise(
            SessionPending.Service.use((svc) =>
              svc.add({
                sessionID: session.id,
                lane,
                draft: {
                  kind: "command",
                  preview,
                  composer: {
                    prompt: [],
                    context: [],
                  },
                  request: {
                    command: preview,
                    arguments: "",
                  },
                },
              }),
            ),
          )
        }

        await AppRuntime.runPromise(SessionPending.Service.use((svc) => svc.beginStop(session.id)))

        expect(
          await AppRuntime.runPromise(SessionPending.Service.use((svc) => svc.get(session.id))),
        ).toMatchObject({
          paused: true,
          steer: [],
        })
        expect(
          (await AppRuntime.runPromise(SessionPending.Service.use((svc) => svc.get(session.id)))).queue.map(
            (item) => item.draft.preview,
          ),
        ).toEqual(["steer1", "steer2", "queue1"])

        await AppRuntime.runPromise(SessionRunState.Service.use((svc) => svc.setPromptRunning(session.id, false)))
        await Session.remove(session.id)
      },
    })
  })

  test("finishStop clears paused when no pending follow-ups remain", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        await AppRuntime.runPromise(SessionPending.Service.use((svc) => svc.beginStop(session.id)))
        await AppRuntime.runPromise(SessionPending.Service.use((svc) => svc.finishStop(session.id)))

        expect(
          await AppRuntime.runPromise(SessionPending.Service.use((svc) => svc.get(session.id))),
        ).toMatchObject({
          paused: false,
          steer: [],
          queue: [],
        })

        await Session.remove(session.id)
      },
    })
  })

  test("removing the last paused pending follow-up clears paused state", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const pending = await AppRuntime.runPromise(
          SessionPending.Service.use((svc) =>
            svc.add({
              sessionID: session.id,
              lane: "queue",
              draft: commandDraft("queue1"),
            }),
          ),
        )
        const itemID = pending.queue[0]?.id
        expect(itemID).toBeTruthy()
        if (!itemID) throw new Error("expected pending item")

        await AppRuntime.runPromise(SessionPending.Service.use((svc) => svc.pause(session.id)))
        const result = await AppRuntime.runPromise(
          SessionPending.Service.use((svc) => svc.remove({ sessionID: session.id, itemID })),
        )

        expect(result).toMatchObject({
          paused: false,
          steer: [],
          queue: [],
        })
        expect(
          await AppRuntime.runPromise(SessionPending.Service.use((svc) => svc.get(session.id))),
        ).toMatchObject({
          paused: false,
          steer: [],
          queue: [],
        })

        await Session.remove(session.id)
      },
    })
  })

  test("queue can be steered in a fresh active run after paused pending was emptied", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const firstPending = await AppRuntime.runPromise(
          SessionPending.Service.use((svc) =>
            svc.add({
              sessionID: session.id,
              lane: "queue",
              draft: commandDraft("old-queue"),
            }),
          ),
        )
        const oldItemID = firstPending.queue[0]?.id
        expect(oldItemID).toBeTruthy()
        if (!oldItemID) throw new Error("expected old pending item")

        await AppRuntime.runPromise(SessionPending.Service.use((svc) => svc.pause(session.id)))
        await AppRuntime.runPromise(
          SessionPending.Service.use((svc) => svc.remove({ sessionID: session.id, itemID: oldItemID })),
        )
        await AppRuntime.runPromise(SessionRunState.Service.use((svc) => svc.setPromptRunning(session.id, true)))

        const nextPending = await AppRuntime.runPromise(
          SessionPending.Service.use((svc) =>
            svc.add({
              sessionID: session.id,
              lane: "queue",
              draft: commandDraft("new-queue"),
            }),
          ),
        )
        const newItemID = nextPending.queue[0]?.id
        expect(newItemID).toBeTruthy()
        if (!newItemID) throw new Error("expected new pending item")

        const moved = await AppRuntime.runPromise(
          SessionPending.Service.use((svc) =>
            svc.moveLane({ sessionID: session.id, itemID: newItemID, lane: "steer" }),
          ),
        )

        expect(moved).toMatchObject({
          paused: false,
          queue: [],
          steer: [
            {
              id: newItemID,
              draft: {
                preview: "new-queue",
              },
            },
          ],
        })

        await AppRuntime.runPromise(SessionRunState.Service.use((svc) => svc.setPromptRunning(session.id, false)))
        await Session.remove(session.id)
      },
    })
  })

  test("pending add resolves command drafts only after steer acceptance", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        await AppRuntime.runPromise(SessionPending.Service.use((svc) => svc.pause(session.id)))
        let resolved = 0

        await expect(
          AppRuntime.runPromise(
            SessionPending.Service.use((svc) =>
              svc.addResolved({
                sessionID: session.id,
                lane: "steer",
                resolveDraft: Effect.sync(() => {
                  resolved += 1
                  return {
                    kind: "command" as const,
                    preview: "pwd",
                    composer: {
                      prompt: [],
                      context: [],
                    },
                    request: {
                      command: "pwd",
                      arguments: "",
                    },
                  }
                }),
              }),
            ),
          ),
        ).rejects.toBeInstanceOf(SessionPending.SteerUnavailableError)

        expect(resolved).toBe(0)

        await Session.remove(session.id)
      },
    })
  })

  test("pending edit commit updates by item id without requiring a server-side edit lock", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const pending = await AppRuntime.runPromise(
          SessionPending.Service.use((svc) =>
            svc.add({
              sessionID: session.id,
              lane: "queue",
              draft: {
                kind: "command",
                preview: "pwd",
                composer: {
                  prompt: [],
                  context: [],
                },
                request: {
                  command: "pwd",
                  arguments: "",
                },
              },
            }),
          ),
        )
        const itemID = pending.queue[0]?.id
        expect(itemID).toBeTruthy()
        if (!itemID) throw new Error("expected pending item")

        await AppRuntime.runPromise(
          SessionRunState.Service.use((svc) => svc.setPromptRunning(session.id, true)),
        )
        await AppRuntime.runPromise(
          SessionPending.Service.use((svc) => svc.moveLane({ sessionID: session.id, itemID, lane: "steer" })),
        )

        let resolved = 0
        const result = await AppRuntime.runPromise(
          SessionPending.Service.use((svc) =>
            svc.commitEditResolved({
              sessionID: session.id,
              itemID,
              resolveDraft: Effect.sync(() => {
                resolved += 1
                return {
                  kind: "command" as const,
                  preview: "ls",
                  composer: {
                    prompt: [],
                    context: [],
                  },
                  request: {
                    command: "ls",
                    arguments: "",
                  },
                }
              }),
            }),
          ),
        )

        expect(resolved).toBe(1)
        expect(result.steer[0]?.id).toBe(itemID)
        expect(result.steer[0]?.draft.preview).toBe("ls")

        await AppRuntime.runPromise(
          SessionRunState.Service.use((svc) => svc.setPromptRunning(session.id, false)),
        )

        await Session.remove(session.id)
      },
    })
  })

  test("late steer additions move to the front of the queue if the active turn closes before draft resolution", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        let release!: () => void
        const gate = new Promise<void>((resolve) => {
          release = resolve
        })

        await AppRuntime.runPromise(SessionRunState.Service.use((svc) => svc.setPromptRunning(session.id, true)))

        const add = AppRuntime.runPromise(
          SessionPending.Service.use((svc) =>
            svc.addResolved({
              sessionID: session.id,
              lane: "steer",
              resolveDraft: Effect.promise(() =>
                gate.then(() => ({
                  kind: "command" as const,
                  preview: "pwd",
                  composer: {
                    prompt: [],
                    context: [],
                  },
                  request: {
                    command: "pwd",
                    arguments: "",
                  },
                })),
              ),
            }),
          ),
        )

        await AppRuntime.runPromise(SessionRunState.Service.use((svc) => svc.setPromptRunning(session.id, false)))
        release()

        await expect(add).resolves.toMatchObject({
          paused: true,
          steer: [],
          queue: [
            {
              draft: {
                preview: "pwd",
              },
            },
          ],
        })

        await Session.remove(session.id)
      },
    })
  })

  test("prepared steer demotion preserves the stable item id for no-reply tracking", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const itemID = "stable-no-reply-id"

        await AppRuntime.runPromise(SessionRunState.Service.use((svc) => svc.setPromptRunning(session.id, true)))
        const result = await AppRuntime.runPromise(
          SessionPending.Service.use((svc) =>
            svc.withLock(
              session.id,
              Effect.gen(function* () {
                const promptRunning = yield* SessionRunState.Service.use((runState) =>
                  runState.isPromptRunning(session.id),
                )
                expect(promptRunning).toBe(true)
                yield* SessionRunState.Service.use((runState) => runState.setPromptRunning(session.id, false))
                return yield* svc.addPreparedWithinLock({
                  sessionID: session.id,
                  lane: "steer",
                  id: itemID,
                  draft: commandDraft("pwd"),
                })
              }),
            ),
          ),
        )

        expect(result).toMatchObject({
          paused: true,
          steer: [],
          queue: [
            {
              id: itemID,
              lane: "queue",
              draft: {
                preview: "pwd",
              },
            },
          ],
        })

        await Session.remove(session.id)
      },
    })
  })

  test("pending additions stay paused while stop is in progress", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        await AppRuntime.runPromise(SessionRunState.Service.use((svc) => svc.requestStop(session.id)))

        await expect(
          AppRuntime.runPromise(
            SessionPending.Service.use((svc) =>
              svc.addResolved({
                sessionID: session.id,
                lane: "queue",
                resolveDraft: Effect.succeed({
                  kind: "command" as const,
                  preview: "pwd",
                  composer: {
                    prompt: [],
                    context: [],
                  },
                  request: {
                    command: "pwd",
                    arguments: "",
                  },
                }),
              }),
            ),
          ),
        ).resolves.toMatchObject({
          paused: true,
          queue: [
            {
              draft: {
                preview: "pwd",
              },
            },
          ],
        })

        await AppRuntime.runPromise(SessionRunState.Service.use((svc) => svc.finishStop(session.id)))
        await Session.remove(session.id)
      },
    })
  })

  test("stop route keeps resume blocked until cancel finishes", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        await AppRuntime.runPromise(SessionPending.Service.use((svc) => svc.beginStop(session.id)))
        await expect(
          AppRuntime.runPromise(SessionPending.Service.use((svc) => svc.resume(session.id))),
        ).rejects.toBeInstanceOf(SessionPending.ConflictError)
        expect(
          await AppRuntime.runPromise(SessionPending.Service.use((svc) => svc.get(session.id))),
        ).toMatchObject({
          paused: true,
        })
        await AppRuntime.runPromise(SessionPending.Service.use((svc) => svc.finishStop(session.id)))
        await Session.remove(session.id)
      },
    })
  })

  test("stop route does not pause a truly empty idle session", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const cancel = spyOn(SessionPrompt, "cancel").mockResolvedValue()
        const app = Server.Default().app
        const qs = `?directory=${encodeURIComponent(tmp.path)}`

        const res = await app.request(`/session/${session.id}/stop${qs}`, {
          method: "POST",
        })

        expect(res.status).toBe(200)
        expect(await res.json()).toBe(true)
        expect(cancel).not.toHaveBeenCalled()
        expect(
          await AppRuntime.runPromise(SessionPending.Service.use((svc) => svc.get(session.id))),
        ).toMatchObject({
          paused: false,
          queue: [],
          steer: [],
        })

        await Session.remove(session.id)
      },
    })
  })

  test("stop route promotes steer items to the front of the queue", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const app = Server.Default().app
        const qs = `?directory=${encodeURIComponent(tmp.path)}`

        await AppRuntime.runPromise(SessionRunState.Service.use((svc) => svc.setPromptRunning(session.id, true)))
        for (const [lane, preview] of [
          ["steer", "steer1"],
          ["steer", "steer2"],
          ["queue", "queue1"],
        ] as const) {
          await AppRuntime.runPromise(
            SessionPending.Service.use((svc) =>
              svc.add({
                sessionID: session.id,
                lane,
                draft: commandDraft(preview),
              }),
            ),
          )
        }

        const res = await app.request(`/session/${session.id}/stop${qs}`, {
          method: "POST",
        })

        expect(res.status).toBe(200)
        expect(await res.json()).toBe(true)
        const pending = await AppRuntime.runPromise(SessionPending.Service.use((svc) => svc.get(session.id)))
        expect(pending).toMatchObject({ paused: true, steer: [] })
        expect(pending.queue.map((item) => item.draft.preview)).toEqual(["steer1", "steer2", "queue1"])

        await Session.remove(session.id)
      },
    })
  })

  test("pending resume route resumes and activates queued work", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const app = Server.Default().app
        const qs = `?directory=${encodeURIComponent(tmp.path)}`
        const activate = spyOn(SessionPrompt, "activatePending").mockResolvedValue()

        await AppRuntime.runPromise(
          SessionPending.Service.use((svc) =>
            svc.add({
              sessionID: session.id,
              lane: "queue",
              draft: commandDraft("queue1"),
            }),
          ),
        )
        await AppRuntime.runPromise(SessionPending.Service.use((svc) => svc.pause(session.id)))

        const res = await app.request(`/session/${session.id}/pending/resume${qs}`, {
          method: "POST",
        })

        expect(res.status).toBe(200)
        expect(await res.json()).toMatchObject({ paused: false })
        expect(activate).toHaveBeenCalledWith(session.id)

        await Session.remove(session.id)
      },
    })
  })

  test("stop route cancels a foreground startup reservation", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const isForegroundStarting = spyOn(SessionPrompt, "isForegroundStarting").mockResolvedValue(true)
        const cancel = spyOn(SessionPrompt, "cancel").mockResolvedValue()
        const app = Server.Default().app
        const qs = `?directory=${encodeURIComponent(tmp.path)}`

        const res = await app.request(`/session/${session.id}/stop${qs}`, {
          method: "POST",
        })

        expect(res.status).toBe(200)
        expect(await res.json()).toBe(true)
        expect(isForegroundStarting).toHaveBeenCalledWith(session.id)
        expect(cancel).toHaveBeenCalledWith(session.id)
        expect(
          await AppRuntime.runPromise(SessionPending.Service.use((svc) => svc.get(session.id))),
        ).toMatchObject({
          paused: false,
          queue: [],
          steer: [],
        })

        await Session.remove(session.id)
      },
    })
  })

  test("stop route pauses an idle session with pending work", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        await AppRuntime.runPromise(
          SessionPending.Service.use((svc) =>
            svc.add({
              sessionID: session.id,
              lane: "queue",
              draft: {
                kind: "command",
                preview: "pwd",
                composer: {
                  prompt: [],
                  context: [],
                },
                request: {
                  command: "pwd",
                  arguments: "",
                },
              },
            }),
          ),
        )
        const cancel = spyOn(SessionPrompt, "cancel").mockResolvedValue()
        const app = Server.Default().app
        const qs = `?directory=${encodeURIComponent(tmp.path)}`

        const res = await app.request(`/session/${session.id}/stop${qs}`, {
          method: "POST",
        })

        expect(res.status).toBe(200)
        expect(await res.json()).toBe(true)
        expect(cancel).not.toHaveBeenCalled()
        expect(
          await AppRuntime.runPromise(SessionPending.Service.use((svc) => svc.get(session.id))),
        ).toMatchObject({
          paused: true,
          queue: [
            {
              draft: {
                preview: "pwd",
              },
            },
          ],
        })

        await Session.remove(session.id)
      },
    })
  })

  test("resume promotes unavailable steer items and starts the queue", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        await AppRuntime.runPromise(SessionRunState.Service.use((svc) => svc.setPromptRunning(session.id, true)))
        await AppRuntime.runPromise(
          SessionPending.Service.use((svc) =>
            svc.add({
              sessionID: session.id,
              lane: "steer",
              draft: {
                kind: "command",
                preview: "pwd",
                composer: {
                  prompt: [],
                  context: [],
                },
                request: {
                  command: "pwd",
                  arguments: "",
                },
              },
            }),
          ),
        )
        await AppRuntime.runPromise(SessionRunState.Service.use((svc) => svc.setPromptRunning(session.id, false)))
        await AppRuntime.runPromise(SessionPending.Service.use((svc) => svc.pause(session.id)))

        const result = await AppRuntime.runPromise(SessionPending.Service.use((svc) => svc.resume(session.id)))

        expect(result).toMatchObject({
          paused: false,
          steer: [],
          queue: [
            {
              draft: {
                preview: "pwd",
              },
            },
          ],
        })

        await Session.remove(session.id)
      },
    })
  })

  test("stop request restores a claimed queue item before dispatch", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const pending = await AppRuntime.runPromise(
          SessionPending.Service.use((svc) =>
            svc.add({
              sessionID: session.id,
              lane: "queue",
              draft: {
                kind: "command",
                preview: "pwd",
                composer: {
                  prompt: [],
                  context: [],
                },
                request: {
                  command: "pwd",
                  arguments: "",
                },
              },
            }),
          ),
        )
        const item = pending.queue[0]
        expect(item).toBeTruthy()
        if (!item) throw new Error("expected pending item")

        const claimed = await AppRuntime.runPromise(SessionPending.Service.use((svc) => svc.takeQueueClaimed(session.id)))
        expect(claimed?.id).toBe(item.id)
        await AppRuntime.runPromise(SessionRunState.Service.use((svc) => svc.requestStop(session.id)))

        const dispatch = await AppRuntime.runPromise(
          SessionPending.Service.use((svc) =>
            svc.dispatchClaimed(session.id, claimed!, Effect.succeed("started")),
          ),
        )

        expect(Option.isNone(dispatch)).toBe(true)
        expect(
          await AppRuntime.runPromise(SessionPending.Service.use((svc) => svc.get(session.id))),
        ).toMatchObject({
          paused: false,
          queue: [
            {
              id: item.id,
              draft: {
                preview: "pwd",
              },
            },
          ],
        })

        await AppRuntime.runPromise(SessionRunState.Service.use((svc) => svc.finishStop(session.id)))
        await Session.remove(session.id)
      },
    })
  })

  test("stop request restores a claimed steer as paused queue work", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        await AppRuntime.runPromise(SessionRunState.Service.use((svc) => svc.setPromptRunning(session.id, true)))
        for (const [lane, preview] of [
          ["steer", "steer1"],
          ["steer", "steer2"],
          ["queue", "queue1"],
        ] as const) {
          await AppRuntime.runPromise(
            SessionPending.Service.use((svc) =>
              svc.add({
                sessionID: session.id,
                lane,
                draft: commandDraft(preview),
              }),
            ),
          )
        }

        const claimed = await AppRuntime.runPromise(SessionPending.Service.use((svc) => svc.takeSteer(session.id)))
        expect(claimed?.draft.preview).toBe("steer1")
        if (!claimed) throw new Error("expected claimed steer item")
        await AppRuntime.runPromise(SessionPending.Service.use((svc) => svc.beginStop(session.id)))

        const dispatch = await AppRuntime.runPromise(
          SessionPending.Service.use((svc) =>
            svc.dispatchClaimed(session.id, claimed, Effect.succeed("started")),
          ),
        )

        expect(Option.isNone(dispatch)).toBe(true)
        const pending = await AppRuntime.runPromise(SessionPending.Service.use((svc) => svc.get(session.id)))
        expect(pending).toMatchObject({
          paused: true,
          steer: [],
        })
        expect(pending.queue.map((item) => item.draft.preview)).toEqual(["steer1", "steer2", "queue1"])
        const restored = pending.queue[0]
        if (!restored) throw new Error("expected restored queue item")
        expect(restored.id).toBe(claimed.id)

        await AppRuntime.runPromise(SessionPending.Service.use((svc) => svc.finishStop(session.id)))
        await AppRuntime.runPromise(SessionRunState.Service.use((svc) => svc.setPromptRunning(session.id, false)))
        await Session.remove(session.id)
      },
    })
  })

  test("pause restores a claimed steer ahead of later steers in the queue", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        await AppRuntime.runPromise(SessionRunState.Service.use((svc) => svc.setPromptRunning(session.id, true)))
        for (const [lane, preview] of [
          ["steer", "steer1"],
          ["steer", "steer2"],
          ["queue", "queue1"],
        ] as const) {
          await AppRuntime.runPromise(
            SessionPending.Service.use((svc) =>
              svc.add({
                sessionID: session.id,
                lane,
                draft: commandDraft(preview),
              }),
            ),
          )
        }

        const claimed = await AppRuntime.runPromise(SessionPending.Service.use((svc) => svc.takeSteer(session.id)))
        expect(claimed?.draft.preview).toBe("steer1")
        if (!claimed) throw new Error("expected claimed steer item")
        await AppRuntime.runPromise(SessionPending.Service.use((svc) => svc.pause(session.id)))

        const dispatch = await AppRuntime.runPromise(
          SessionPending.Service.use((svc) =>
            svc.dispatchClaimed(session.id, claimed, Effect.succeed("started")),
          ),
        )

        expect(Option.isNone(dispatch)).toBe(true)
        const pending = await AppRuntime.runPromise(SessionPending.Service.use((svc) => svc.get(session.id)))
        expect(pending).toMatchObject({
          paused: true,
          steer: [],
        })
        expect(pending.queue.map((item) => item.draft.preview)).toEqual(["steer1", "steer2", "queue1"])
        const restored = pending.queue[0]
        if (!restored) throw new Error("expected restored queue item")
        expect(restored.id).toBe(claimed.id)

        await AppRuntime.runPromise(SessionRunState.Service.use((svc) => svc.setPromptRunning(session.id, false)))
        await Session.remove(session.id)
      },
    })
  })

  test("same-lane move requests do not reorder pending items", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const first = await AppRuntime.runPromise(
          SessionPending.Service.use((svc) =>
            svc.add({
              sessionID: session.id,
              lane: "queue",
              draft: {
                kind: "command",
                preview: "first",
                composer: {
                  prompt: [],
                  context: [],
                },
                request: {
                  command: "first",
                  arguments: "",
                },
              },
            }),
          ),
        )
        const second = await AppRuntime.runPromise(
          SessionPending.Service.use((svc) =>
            svc.add({
              sessionID: session.id,
              lane: "queue",
              draft: {
                kind: "command",
                preview: "second",
                composer: {
                  prompt: [],
                  context: [],
                },
                request: {
                  command: "second",
                  arguments: "",
                },
              },
            }),
          ),
        )
        const itemID = first.queue[0]?.id
        expect(itemID).toBeTruthy()
        if (!itemID) throw new Error("expected first pending item")

        const moved = await AppRuntime.runPromise(
          SessionPending.Service.use((svc) =>
            svc.moveLane({
              sessionID: session.id,
              itemID,
              lane: "queue",
            }),
          ),
        )

        expect(moved.queue.map((item) => item.draft.preview)).toEqual(["first", "second"])
        expect(second.queue.map((item) => item.draft.preview)).toEqual(["first", "second"])

        await Session.remove(session.id)
      },
    })
  })

  test("delete message route returns 400 when session is busy", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const msg = await user(session.id, "hello")
        const busy = spyOn(SessionRunState, "assertNotBusy").mockRejectedValue(new Session.BusyError(session.id))
        const remove = spyOn(Session, "removeMessage").mockResolvedValue(msg.id)
        const app = Server.Default().app
        const qs = `?directory=${encodeURIComponent(tmp.path)}`

        const res = await app.request(`/session/${session.id}/message/${msg.id}${qs}`, {
          method: "DELETE",
        })

        expect(res.status).toBe(400)
        expect(busy).toHaveBeenCalledWith(session.id)
        expect(remove).not.toHaveBeenCalled()

        await Session.remove(session.id)
      },
    })
  })

  test("revert route returns 409 when pending followups require resolution first", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const msg = await user(session.id, "hello")
        await AppRuntime.runPromise(
          SessionPending.Service.use((svc) =>
            svc.add({
              sessionID: session.id,
              lane: "queue",
              draft: {
                kind: "prompt",
                preview: "queued",
                composer: {
                  prompt: [{ type: "text", content: "queued", start: 0, end: 6 }],
                  context: [],
                },
                request: {
                  messageID: MessageID.ascending(),
                  parts: [{ type: "text", text: "queued" }],
                  agent: "build",
                  model: { providerID: ProviderID.make("test"), modelID: ModelID.make("test") },
                },
              },
            }),
          ),
        )

        const app = Server.Default().app
        const qs = `?directory=${encodeURIComponent(tmp.path)}`
        const res = await app.request(`/session/${session.id}/revert${qs}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ messageID: msg.id }),
        })

        expect(res.status).toBe(409)

        await Session.remove(session.id)
      },
    })
  })
})
