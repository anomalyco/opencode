/** @jsxImportSource @opentui/solid */
import { describe, expect, test } from "bun:test"
import type { GlobalEvent, PermissionRequest } from "@opencode-ai/sdk/v2"
import { json, mount, wait } from "./sync-fixture"
import { cycleMode, type ModeCycleState } from "../../../../src/mode-cycle"

function permission(id: string, sessionID = "ses_auto"): PermissionRequest {
  return {
    id,
    sessionID,
    permission: "bash",
    patterns: ["git status"],
    metadata: { command: "git status" },
    always: [],
  }
}

function asked(request: PermissionRequest): GlobalEvent {
  return {
    directory: "/tmp/opencode/packages/tui",
    project: "proj_test",
    payload: {
      id: `evt_${request.id}`,
      type: "permission.asked",
      properties: request,
    },
  }
}

function replied(request: PermissionRequest): GlobalEvent {
  return {
    directory: "/tmp/opencode/packages/tui",
    project: "proj_test",
    payload: {
      id: `evt_replied_${request.id}`,
      type: "permission.replied",
      properties: { sessionID: request.sessionID, requestID: request.id, reply: "once" },
    },
  }
}

function disposed(): GlobalEvent {
  return {
    directory: "/tmp/opencode/packages/tui",
    project: "proj_test",
    payload: {
      id: "evt_disposed",
      type: "server.instance.disposed",
      properties: { directory: "/tmp/opencode/packages/tui" },
    },
  }
}

describe("tui model-gated permission auto mode", () => {
  test("normal mode never classifies and uses the pending permission store", async () => {
    let classified = 0
    const mounted = await mount((url) => {
      if (url.pathname.endsWith("/classify")) {
        classified++
        return json(true)
      }
    })

    try {
      mounted.emit(asked(permission("per_normal")))
      await wait(() => mounted.sync.data.permission.ses_auto?.length === 1)
      expect(classified).toBe(0)
      expect(mounted.sync.data.permission.ses_auto[0].id).toBe("per_normal")
    } finally {
      mounted.app.renderer.destroy()
    }
  })

  test("entering auto mode does not retroactively classify an existing normal dialog", async () => {
    let classified = 0
    const mounted = await mount((url) => {
      if (url.pathname.endsWith("/classify")) {
        classified++
        return json(true)
      }
    })

    try {
      mounted.emit(asked(permission("per_existing_dialog")))
      await wait(() => mounted.sync.data.permission.ses_auto?.length === 1)
      mounted.permission.set("auto")
      await Bun.sleep(30)
      expect(classified).toBe(0)
      expect(mounted.sync.data.permission.ses_auto[0].id).toBe("per_existing_dialog")
    } finally {
      mounted.app.renderer.destroy()
    }
  })

  test("a positive decision sends one reply for duplicate events", async () => {
    let classified = 0
    let replied = 0
    let reply: unknown
    const mounted = await mount(async (url, request) => {
      if (url.pathname.endsWith("/classify")) {
        classified++
        return json(true)
      }
      if (url.pathname.endsWith("/reply")) {
        replied++
        reply = await request.json()
        return json(true)
      }
    })

    try {
      mounted.permission.set("auto")
      const event = asked(permission("per_positive"))
      mounted.emit(event)
      mounted.emit(event)
      await wait(() => replied === 1)
      expect(classified).toBe(1)
      expect(replied).toBe(1)
      expect(reply).toEqual({ reply: "once" })
      expect(mounted.sync.data.permission.ses_auto).toBeUndefined()
    } finally {
      mounted.app.renderer.destroy()
    }
  })

  test("negative, classifier error, and reply error all recover the normal dialog", async () => {
    const mounted = await mount((url) => {
      if (url.pathname.includes("per_negative") && url.pathname.endsWith("/classify")) return json(false)
      if (url.pathname.includes("per_classifier_error") && url.pathname.endsWith("/classify")) {
        throw new Error("classifier unavailable")
      }
      if (url.pathname.endsWith("/classify")) return json(true)
      if (url.pathname.includes("per_reply_error") && url.pathname.endsWith("/reply")) {
        return json({ error: "missing" }, { status: 404 })
      }
    })

    try {
      mounted.permission.set("auto")
      mounted.emit(asked(permission("per_negative")))
      mounted.emit(asked(permission("per_classifier_error")))
      mounted.emit(asked(permission("per_reply_error")))
      await wait(() => mounted.sync.data.permission.ses_auto?.length === 3)
      expect(mounted.sync.data.permission.ses_auto.map((item) => item.id)).toEqual([
        "per_classifier_error",
        "per_negative",
        "per_reply_error",
      ])
    } finally {
      mounted.app.renderer.destroy()
    }
  })

  test("disabling and re-enabling auto mode invalidates an in-flight approval", async () => {
    let resolve!: (response: Response) => void
    const result = new Promise<Response>((done) => {
      resolve = done
    })
    let replied = 0
    let classifyRequest: Request | undefined
    const mounted = await mount((url, request) => {
      if (url.pathname.endsWith("/classify")) {
        classifyRequest = request
        return result
      }
      if (url.pathname.endsWith("/reply")) {
        replied++
        return json(true)
      }
    })

    try {
      mounted.permission.set("auto")
      mounted.emit(asked(permission("per_toggle")))
      await wait(() => classifyRequest !== undefined)
      mounted.permission.set("normal")
      await wait(() => mounted.sync.data.permission.ses_auto?.length === 1)
      expect(classifyRequest?.signal.aborted).toBe(true)
      mounted.permission.set("auto")
      resolve(json(true))
      await Bun.sleep(30)
      expect(replied).toBe(0)
      expect(mounted.sync.data.permission.ses_auto[0].id).toBe("per_toggle")
    } finally {
      mounted.app.renderer.destroy()
    }
  })

  test.each([
    [1, { agent: "build", permission: "normal" }],
    [-1, { agent: "plan", permission: "normal" }],
  ] satisfies Array<[1 | -1, ModeCycleState]>)(
    "cycling from Auto-approve in direction %i recovers $1 immediately with no late reply",
    async (direction, expected) => {
      let resolve!: (response: Response) => void
      const result = new Promise<Response>((done) => {
        resolve = done
      })
      let replied = 0
      let classifyRequest: Request | undefined
      const mounted = await mount((url, request) => {
        if (url.pathname.endsWith("/classify")) {
          classifyRequest = request
          return result
        }
        if (url.pathname.endsWith("/reply")) {
          replied++
          return json(true)
        }
      })

      try {
        mounted.permission.set("auto")
        mounted.emit(asked(permission(`per_cycle_${expected.agent}`)))
        await wait(() => classifyRequest !== undefined)
        const transition = cycleMode({
          direction,
          current: { agent: "build", permission: mounted.permission.mode },
          available: ["build", "plan"],
        })
        expect(transition).toEqual(expected)
        mounted.permission.set(transition.permission)
        await wait(() => mounted.sync.data.permission.ses_auto?.length === 1)
        expect(classifyRequest?.signal.aborted).toBe(true)
        resolve(json(true))
        await Bun.sleep(30)
        expect(replied).toBe(0)
        expect(mounted.sync.data.permission.ses_auto[0].id).toBe(`per_cycle_${expected.agent}`)
      } finally {
        mounted.app.renderer.destroy()
      }
    },
  )

  test("recovers a permission when the classification transport never settles", async () => {
    let replied = 0
    const mounted = await mount((url) => {
      if (url.pathname.endsWith("/classify")) return new Promise<Response>(() => {})
      if (url.pathname.endsWith("/reply")) {
        replied++
        return json(true)
      }
    })

    try {
      mounted.permission.set("auto")
      mounted.emit(asked(permission("per_timeout")))
      await wait(() => mounted.sync.data.permission.ses_auto?.length === 1, 7_000)
      expect(replied).toBe(0)
      expect(mounted.sync.data.permission.ses_auto[0].id).toBe("per_timeout")
    } finally {
      mounted.app.renderer.destroy()
    }
  }, 8_000)

  test("recovers when the once-reply transport never settles", async () => {
    const mounted = await mount((url) => {
      if (url.pathname.endsWith("/classify")) return json(true)
      if (url.pathname.endsWith("/reply")) return new Promise<Response>(() => {})
    })

    try {
      mounted.permission.set("auto")
      mounted.emit(asked(permission("per_reply_timeout")))
      await wait(() => mounted.sync.data.permission.ses_auto?.length === 1, 7_000)
      expect(mounted.sync.data.permission.ses_auto[0].id).toBe("per_reply_timeout")
    } finally {
      mounted.app.renderer.destroy()
    }
  }, 8_000)

  test("a resolved event removes a recovered dialog and blocks a late classifier result", async () => {
    let resolve!: (response: Response) => void
    const result = new Promise<Response>((done) => {
      resolve = done
    })
    let replies = 0
    const mounted = await mount((url) => {
      if (url.pathname.endsWith("/classify")) return result
      if (url.pathname.endsWith("/reply")) {
        replies++
        return json(true)
      }
    })

    try {
      const request = permission("per_resolved")
      mounted.permission.set("auto")
      mounted.emit(asked(request))
      mounted.permission.set("normal")
      await wait(() => mounted.sync.data.permission.ses_auto?.length === 1)
      mounted.emit(replied(request))
      await wait(() => mounted.sync.data.permission.ses_auto?.length === 0)
      resolve(json(true))
      await Bun.sleep(30)
      expect(replies).toBe(0)
      expect(mounted.sync.data.permission.ses_auto).toEqual([])
    } finally {
      mounted.app.renderer.destroy()
    }
  })

  test("instance disposal aborts an attempt and blocks its late positive result", async () => {
    let resolve!: (response: Response) => void
    const result = new Promise<Response>((done) => {
      resolve = done
    })
    let classifyRequest: Request | undefined
    let replies = 0
    const mounted = await mount((url, request) => {
      if (url.pathname.endsWith("/classify")) {
        classifyRequest = request
        return result
      }
      if (url.pathname.endsWith("/reply")) {
        replies++
        return json(true)
      }
    })

    try {
      mounted.permission.set("auto")
      mounted.emit(asked(permission("per_disposed")))
      await wait(() => classifyRequest !== undefined)
      mounted.emit(disposed())
      await wait(() => classifyRequest?.signal.aborted === true)
      resolve(json(true))
      await Bun.sleep(30)
      expect(replies).toBe(0)
    } finally {
      mounted.app.renderer.destroy()
    }
  })

  test("a duplicate ask after disposal cannot combine with the old attempt for two replies", async () => {
    const resolvers: Array<(response: Response) => void> = []
    let classifications = 0
    let replies = 0
    const mounted = await mount((url) => {
      if (url.pathname.endsWith("/classify")) {
        classifications++
        return new Promise<Response>((resolve) => resolvers.push(resolve))
      }
      if (url.pathname.endsWith("/reply")) {
        replies++
        return json(true)
      }
    })

    try {
      mounted.permission.set("auto")
      const event = asked(permission("per_disposed_duplicate"))
      mounted.emit(event)
      await wait(() => classifications === 1)
      mounted.emit(disposed())
      mounted.emit(event)
      await wait(() => classifications === 2)
      resolvers[0](json(true))
      resolvers[1](json(true))
      await wait(() => replies === 1)
      await Bun.sleep(30)
      expect(replies).toBe(1)
    } finally {
      mounted.app.renderer.destroy()
    }
  })

  test("classifies concurrent requests independently", async () => {
    const classified: string[] = []
    const replied: string[] = []
    const mounted = await mount((url) => {
      if (url.pathname.endsWith("/classify")) {
        classified.push(url.pathname)
        return json(url.pathname.includes("per_allow"))
      }
      if (url.pathname.endsWith("/reply")) {
        replied.push(url.pathname)
        return json(true)
      }
    })

    try {
      mounted.permission.set("auto")
      mounted.emit(asked(permission("per_allow", "ses_a")))
      mounted.emit(asked(permission("per_ask", "ses_b")))
      await wait(() => replied.length === 1 && mounted.sync.data.permission.ses_b?.length === 1)
      expect(classified).toHaveLength(2)
      expect(replied[0]).toContain("per_allow")
      expect(mounted.sync.data.permission.ses_a).toBeUndefined()
      expect(mounted.sync.data.permission.ses_b[0].id).toBe("per_ask")
    } finally {
      mounted.app.renderer.destroy()
    }
  })
})
