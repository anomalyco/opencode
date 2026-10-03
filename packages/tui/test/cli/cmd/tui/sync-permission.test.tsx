/** @jsxImportSource @opentui/solid */
import { describe, expect, test } from "bun:test"
import type { GlobalEvent, PermissionRequest } from "@opencode-ai/sdk/v2"
import { directory, json, mount, wait } from "./sync-fixture"

const OTHER_DIRECTORY = "/tmp/opencode/packages/other"

function permission(id: string, sessionID = "ses_auto"): PermissionRequest {
  return {
    id,
    sessionID,
    permission: "bash",
    patterns: ["git status"],
    metadata: { command: "git status" },
    always: [],
    tool: { messageID: `msg_${sessionID}`, callID: `call_${id}` },
  }
}

function asked(request: PermissionRequest, dir = directory): GlobalEvent {
  return {
    directory: dir,
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

function disposed(dir = directory): GlobalEvent {
  return {
    directory: dir,
    project: "proj_test",
    payload: {
      id: "evt_disposed",
      type: "server.instance.disposed",
      properties: { directory: dir },
    },
  }
}

describe("tui model-gated permission review mode", () => {
  test("normal mode never classifies and uses the pending permission store", async () => {
    let classified = 0
    const mounted = await mount((url) => {
      if (url.pathname.endsWith("/classify")) {
        classified++
        return json({ approved: true })
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

  test("legacy --auto replies directly without classifying", async () => {
    let classified = 0
    let replied = 0
    let reply: unknown
    const mounted = await mount(
      async (url, request) => {
        if (url.pathname.endsWith("/classify")) classified++
        if (url.pathname.endsWith("/reply")) {
          replied++
          reply = await request.json()
          return json(true)
        }
      },
      undefined,
      { auto: true },
    )

    try {
      expect(mounted.permission.mode).toBe("auto")
      mounted.emit(asked(permission("per_legacy_auto")))
      await wait(() => replied === 1)
      expect(classified).toBe(0)
      expect(reply).toEqual({ reply: "once" })
      expect(mounted.sync.data.permission.ses_auto).toBeUndefined()
    } finally {
      mounted.app.renderer.destroy()
    }
  })

  test("entering review mode does not retroactively classify an existing normal dialog", async () => {
    let classified = 0
    const mounted = await mount((url) => {
      if (url.pathname.endsWith("/classify")) {
        classified++
        return json({ approved: true })
      }
    })

    try {
      mounted.emit(asked(permission("per_existing_dialog")))
      await wait(() => mounted.sync.data.permission.ses_auto?.length === 1)
      mounted.permission.set("review")
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
        return json({ approved: true })
      }
      if (url.pathname.endsWith("/reply")) {
        replied++
        reply = await request.json()
        return json(true)
      }
    })

    try {
      mounted.permission.set("review")
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
      if (url.pathname.includes("per_negative") && url.pathname.endsWith("/classify")) return json({ approved: false })
      if (url.pathname.includes("per_classifier_error") && url.pathname.endsWith("/classify")) {
        throw new Error("classifier unavailable")
      }
      if (url.pathname.endsWith("/classify")) return json({ approved: true })
      if (url.pathname.includes("per_reply_error") && url.pathname.endsWith("/reply")) {
        return json({ error: "missing" }, { status: 404 })
      }
    })

    try {
      mounted.permission.set("review")
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

  test("keeps opt-in classifier details in TUI-local state", async () => {
    const mounted = await mount((url) => {
      if (url.pathname.endsWith("/classify")) {
        return json({
          approved: false,
          details: { input: '{"userRequest":"Clean up"}', output: "ASK" },
        })
      }
    })

    try {
      const request = permission("per_details")
      const tool = request.tool
      if (!tool) throw new Error("missing tool identity")
      mounted.permission.set("review")
      mounted.emit(asked(request))
      await wait(() => mounted.sync.data.permission.ses_auto?.length === 1)
      expect(mounted.sync.autoApprove.get(tool.messageID, tool.callID)).toEqual({
        request,
        approved: false,
        input: '{"userRequest":"Clean up"}',
        output: "ASK",
      })
      expect(mounted.sync.data.message.ses_auto).toBeUndefined()
      expect(mounted.sync.data.part[tool.messageID]).toBeUndefined()
    } finally {
      mounted.app.renderer.destroy()
    }
  })

  test("records an applied auto-approval without classifier details", async () => {
    const mounted = await mount((url) => {
      if (url.pathname.endsWith("/classify")) return json({ approved: true })
      if (url.pathname.endsWith("/reply")) return json(true)
    })

    try {
      const request = permission("per_audit")
      const tool = request.tool
      if (!tool) throw new Error("missing tool identity")
      mounted.permission.set("review")
      mounted.emit(asked(request))
      await wait(() => mounted.sync.autoApprove.get(tool.messageID, tool.callID)?.applied === true)
      expect(mounted.sync.autoApprove.get(tool.messageID, tool.callID)).toEqual({
        request,
        approved: true,
        applied: true,
      })
      expect(mounted.sync.data.permission.ses_auto).toBeUndefined()
      expect(mounted.sync.data.message.ses_auto).toBeUndefined()
      expect(mounted.sync.data.part[tool.messageID]).toBeUndefined()
    } finally {
      mounted.app.renderer.destroy()
    }
  })

  test("does not claim an auto-approval when the reply is rejected", async () => {
    const mounted = await mount((url) => {
      if (url.pathname.endsWith("/classify")) return json({ approved: true })
      if (url.pathname.endsWith("/reply")) return json(false)
    })

    try {
      const request = permission("per_reply_rejected")
      const tool = request.tool
      if (!tool) throw new Error("missing tool identity")
      mounted.permission.set("review")
      mounted.emit(asked(request))
      await wait(() => mounted.sync.data.permission.ses_auto?.length === 1)
      const trace = mounted.sync.autoApprove.get(tool.messageID, tool.callID)
      expect(trace?.approved).toBe(true)
      expect(trace?.applied).toBeFalsy()
    } finally {
      mounted.app.renderer.destroy()
    }
  })

  test("does not claim an auto-approval that another reply resolved first", async () => {
    let release!: (response: Response) => void
    const pending = new Promise<Response>((resolve) => {
      release = resolve
    })
    const mounted = await mount((url) => {
      if (url.pathname.endsWith("/classify")) return json({ approved: true })
      if (url.pathname.endsWith("/reply")) return pending
    })

    try {
      const request = permission("per_cascaded_reject")
      const tool = request.tool
      if (!tool) throw new Error("missing tool identity")
      mounted.permission.set("review")
      mounted.emit(asked(request))
      await wait(() => mounted.sync.autoApprove.get(tool.messageID, tool.callID) !== undefined)

      // Rejecting one permission cascades server-side and resolves every other pending request
      // in the session, so this event is not the echo of our own reply.
      mounted.emit(replied(request))
      release(json(false) as unknown as Response)
      await Bun.sleep(50)

      const trace = mounted.sync.autoApprove.get(tool.messageID, tool.callID)
      expect(trace?.approved).toBe(true)
      // The action was rejected and never ran, so recording it as auto-approved would be a lie.
      expect(trace?.applied).toBeFalsy()
    } finally {
      mounted.app.renderer.destroy()
    }
  })

  test("announces a permission only when it reaches the dialog", async () => {
    const mounted = await mount((url) => {
      if (url.pathname.includes("per_ask") && url.pathname.endsWith("/classify")) return json({ approved: false })
      if (url.pathname.endsWith("/classify")) return json({ approved: true })
      if (url.pathname.endsWith("/reply")) return json(true)
    })

    try {
      const seen: string[] = []
      mounted.sync.permission.onVisible((request) => seen.push(request.id))
      mounted.permission.set("review")
      const ask = asked(permission("per_ask"))
      mounted.emit(asked(permission("per_ok")))
      mounted.emit(ask)
      await wait(() => mounted.sync.data.permission.ses_auto?.length === 1)
      expect(seen).toEqual(["per_ask"])
      mounted.emit(ask)
      await Bun.sleep(30)
      expect(seen).toEqual(["per_ask"])
    } finally {
      mounted.app.renderer.destroy()
    }
  })

  test("legacy --auto never announces a permission it silently replies to", async () => {
    let replies = 0
    const mounted = await mount(
      (url) => {
        if (url.pathname.endsWith("/reply")) {
          replies++
          return json(true)
        }
      },
      undefined,
      { auto: true },
    )

    try {
      const seen: string[] = []
      mounted.sync.permission.onVisible((request) => seen.push(request.id))
      mounted.emit(asked(permission("per_legacy_silent")))
      await wait(() => replies === 1)
      await Bun.sleep(30)
      expect(seen).toEqual([])
    } finally {
      mounted.app.renderer.destroy()
    }
  })

  test("instance disposal drops stored classifier details", async () => {
    const mounted = await mount((url) => {
      if (url.pathname.endsWith("/classify")) {
        return json({ approved: false, details: { input: "{}", output: "ASK" } })
      }
    })

    try {
      const request = permission("per_disposed_details")
      const tool = request.tool
      if (!tool) throw new Error("missing tool identity")
      mounted.permission.set("review")
      mounted.emit(asked(request))
      await wait(() => mounted.sync.autoApprove.get(tool.messageID, tool.callID) !== undefined)
      mounted.emit(disposed())
      await Bun.sleep(50)
      expect(mounted.sync.autoApprove.get(tool.messageID, tool.callID)).toBeUndefined()
    } finally {
      mounted.app.renderer.destroy()
    }
  })

  test("records classifier details that arrive after the attempt already recovered", async () => {
    process.env["OPENCODE_TUI_AUTO_APPROVE_FALLBACK_MS"] = "300"
    let resolve!: (response: Response) => void
    const result = new Promise<Response>((done) => {
      resolve = done
    })
    let replied = 0
    const mounted = await mount((url) => {
      if (url.pathname.endsWith("/classify")) return result
      if (url.pathname.endsWith("/reply")) {
        replied++
        return json(true)
      }
    })

    try {
      const request = permission("per_late_details")
      const tool = request.tool
      if (!tool) throw new Error("missing tool identity")
      mounted.permission.set("review")
      mounted.emit(asked(request))
      await wait(() => mounted.sync.data.permission.ses_auto?.length === 1, 5_000)
      resolve(json({ approved: true, details: { input: '{"userRequest":"late"}', output: "AUTO_APPROVE" } }))
      await wait(() => mounted.sync.autoApprove.get(tool.messageID, tool.callID) !== undefined, 5_000)
      expect(mounted.sync.autoApprove.get(tool.messageID, tool.callID)?.output).toBe("AUTO_APPROVE")
      expect(replied).toBe(0)
      expect(mounted.sync.data.permission.ses_auto[0].id).toBe("per_late_details")
    } finally {
      delete process.env["OPENCODE_TUI_AUTO_APPROVE_FALLBACK_MS"]
      mounted.app.renderer.destroy()
    }
  }, 10_000)

  test("disabling and re-enabling review mode invalidates an in-flight approval", async () => {
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
      mounted.permission.set("review")
      mounted.emit(asked(permission("per_toggle")))
      await wait(() => classifyRequest !== undefined)
      mounted.permission.set("normal")
      await wait(() => mounted.sync.data.permission.ses_auto?.length === 1)
      expect(classifyRequest?.signal.aborted).toBe(true)
      mounted.permission.set("review")
      resolve(json({ approved: true }))
      await Bun.sleep(30)
      expect(replied).toBe(0)
      expect(mounted.sync.data.permission.ses_auto[0].id).toBe("per_toggle")
    } finally {
      mounted.app.renderer.destroy()
    }
  })

  test("recovers a permission when the classification transport never settles", async () => {
    process.env["OPENCODE_TUI_AUTO_APPROVE_FALLBACK_MS"] = "500"
    let replied = 0
    const mounted = await mount((url) => {
      if (url.pathname.endsWith("/classify")) return new Promise<Response>(() => {})
      if (url.pathname.endsWith("/reply")) {
        replied++
        return json(true)
      }
    })

    try {
      mounted.permission.set("review")
      mounted.emit(asked(permission("per_timeout")))
      await wait(() => mounted.sync.data.permission.ses_auto?.length === 1, 7_000)
      expect(replied).toBe(0)
      expect(mounted.sync.data.permission.ses_auto[0].id).toBe("per_timeout")
    } finally {
      delete process.env["OPENCODE_TUI_AUTO_APPROVE_FALLBACK_MS"]
      mounted.app.renderer.destroy()
    }
  }, 8_000)

  test("recovers when the once-reply transport never settles", async () => {
    process.env["OPENCODE_TUI_AUTO_APPROVE_FALLBACK_MS"] = "500"
    process.env["OPENCODE_TUI_AUTO_APPROVE_REPLY_MS"] = "500"
    const mounted = await mount((url) => {
      if (url.pathname.endsWith("/classify")) return json({ approved: true })
      if (url.pathname.endsWith("/reply")) return new Promise<Response>(() => {})
    })

    try {
      mounted.permission.set("review")
      mounted.emit(asked(permission("per_reply_timeout")))
      // The in-flight guard must not outlive the reply: a response that never arrives has to
      // end in a dialog, not in a permission that stays hidden forever.
      await wait(() => mounted.sync.data.permission.ses_auto?.length === 1, 7_000)
      expect(mounted.sync.data.permission.ses_auto[0].id).toBe("per_reply_timeout")
    } finally {
      delete process.env["OPENCODE_TUI_AUTO_APPROVE_FALLBACK_MS"]
      delete process.env["OPENCODE_TUI_AUTO_APPROVE_REPLY_MS"]
      mounted.app.renderer.destroy()
    }
  }, 8_000)

  test("a fallback deadline never takes back an in-flight reply", async () => {
    process.env["OPENCODE_TUI_AUTO_APPROVE_FALLBACK_MS"] = "200"
    let replyRequest: Request | undefined
    let replies = 0
    const mounted = await mount((url, request) => {
      if (url.pathname.endsWith("/classify")) return json({ approved: true })
      if (url.pathname.endsWith("/reply")) {
        replyRequest = request
        replies++
        return new Promise<Response>(() => {})
      }
    })

    try {
      mounted.permission.set("review")
      mounted.emit(asked(permission("per_reply_inflight")))
      await wait(() => replyRequest !== undefined)
      await Bun.sleep(500)
      expect(mounted.sync.data.permission.ses_auto).toBeUndefined()
      expect(replyRequest?.signal.aborted).toBe(false)
      expect(replies).toBe(1)
    } finally {
      delete process.env["OPENCODE_TUI_AUTO_APPROVE_FALLBACK_MS"]
      mounted.app.renderer.destroy()
    }
  }, 8_000)

  test("a failed reply after the fallback deadline still recovers the dialog", async () => {
    process.env["OPENCODE_TUI_AUTO_APPROVE_FALLBACK_MS"] = "200"
    let resolve!: (response: Response) => void
    const result = new Promise<Response>((done) => {
      resolve = done
    })
    let replyRequest: Request | undefined
    const mounted = await mount((url, request) => {
      if (url.pathname.endsWith("/classify")) return json({ approved: true })
      if (url.pathname.endsWith("/reply")) {
        replyRequest = request
        return result
      }
    })

    try {
      mounted.permission.set("review")
      mounted.emit(asked(permission("per_reply_late_error")))
      await wait(() => replyRequest !== undefined)
      await Bun.sleep(500)
      expect(mounted.sync.data.permission.ses_auto).toBeUndefined()
      expect(replyRequest?.signal.aborted).toBe(false)
      resolve(json({ error: "missing" }, { status: 404 }))
      await wait(() => mounted.sync.data.permission.ses_auto?.length === 1)
      expect(mounted.sync.data.permission.ses_auto[0].id).toBe("per_reply_late_error")
    } finally {
      delete process.env["OPENCODE_TUI_AUTO_APPROVE_FALLBACK_MS"]
      mounted.app.renderer.destroy()
    }
  }, 8_000)

  test("a successful auto-approval releases the request id for a repeated ask", async () => {
    let classified = 0
    let replied = 0
    const mounted = await mount((url) => {
      if (url.pathname.endsWith("/classify")) {
        classified++
        return json({ approved: true })
      }
      if (url.pathname.endsWith("/reply")) {
        replied++
        return json(true)
      }
    })

    try {
      mounted.permission.set("review")
      const event = asked(permission("per_leak"))
      mounted.emit(event)
      await wait(() => replied === 1)
      // No permission.replied event: models a dropped SSE frame, the only other cleanup path.
      mounted.emit(event)
      await wait(() => classified === 2)
      await Bun.sleep(30)
      expect(replied).toBe(2)
    } finally {
      mounted.app.renderer.destroy()
    }
  })

  test("disposing one instance leaves another directory's pending review visible", async () => {
    const classified: string[] = []
    const mounted = await mount((url) => {
      if (url.pathname.endsWith("/classify")) {
        classified.push(url.pathname)
        return new Promise<Response>(() => {})
      }
    })

    try {
      mounted.permission.set("review")
      mounted.emit(asked(permission("per_dir_live", "ses_live"), directory))
      mounted.emit(asked(permission("per_dir_dead", "ses_dead"), OTHER_DIRECTORY))
      await wait(() => classified.length === 2)
      mounted.emit(disposed(OTHER_DIRECTORY))
      await wait(() => mounted.sync.data.permission.ses_live?.length === 1)
      await Bun.sleep(30)
      expect(mounted.sync.data.permission.ses_live[0].id).toBe("per_dir_live")
      expect(mounted.sync.data.permission.ses_dead).toBeUndefined()
    } finally {
      mounted.app.renderer.destroy()
    }
  })

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
      mounted.permission.set("review")
      mounted.emit(asked(request))
      mounted.permission.set("normal")
      await wait(() => mounted.sync.data.permission.ses_auto?.length === 1)
      mounted.emit(replied(request))
      await wait(() => mounted.sync.data.permission.ses_auto?.length === 0)
      resolve(json({ approved: true }))
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
      mounted.permission.set("review")
      mounted.emit(asked(permission("per_disposed")))
      await wait(() => classifyRequest !== undefined)
      mounted.emit(disposed())
      await wait(() => classifyRequest?.signal.aborted === true)
      resolve(json({ approved: true }))
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
      mounted.permission.set("review")
      const event = asked(permission("per_disposed_duplicate"))
      mounted.emit(event)
      await wait(() => classifications === 1)
      mounted.emit(disposed())
      mounted.emit(event)
      await wait(() => classifications === 2)
      resolvers[0](json({ approved: true }))
      resolvers[1](json({ approved: true }))
      await wait(() => replies === 1)
      await Bun.sleep(30)
      expect(replies).toBe(1)
    } finally {
      mounted.app.renderer.destroy()
    }
  })

  test("toggling out of review mode leaves normal mode and never blanket auto", async () => {
    let classified = 0
    let replied = 0
    const mounted = await mount((url) => {
      if (url.pathname.endsWith("/classify")) {
        classified++
        return json({ approved: true })
      }
      if (url.pathname.endsWith("/reply")) {
        replied++
        return json(true)
      }
    })

    try {
      mounted.permission.set("review")
      const revision = mounted.permission.revision
      mounted.permission.toggle()
      expect(mounted.permission.mode).toBe("normal")
      expect(mounted.permission.revision).toBe(revision + 1)
      mounted.emit(asked(permission("per_toggled_out")))
      await wait(() => mounted.sync.data.permission.ses_auto?.length === 1)
      await Bun.sleep(30)
      expect(classified).toBe(0)
      expect(replied).toBe(0)
      expect(mounted.sync.data.permission.ses_auto[0].id).toBe("per_toggled_out")
    } finally {
      mounted.app.renderer.destroy()
    }
  })

  test("toggling still round-trips between normal and legacy auto", async () => {
    const mounted = await mount()

    try {
      expect(mounted.permission.mode).toBe("normal")
      mounted.permission.toggle()
      expect(mounted.permission.mode).toBe("auto")
      expect(mounted.permission.revision).toBe(1)
      mounted.permission.toggle()
      expect(mounted.permission.mode).toBe("normal")
      expect(mounted.permission.revision).toBe(2)
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
        return json({ approved: url.pathname.includes("per_allow") })
      }
      if (url.pathname.endsWith("/reply")) {
        replied.push(url.pathname)
        return json(true)
      }
    })

    try {
      mounted.permission.set("review")
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
