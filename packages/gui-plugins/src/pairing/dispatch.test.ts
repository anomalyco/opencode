import { describe, expect, test } from "bun:test"
import { copyEffectFailed, createCopyState, transitionCopy } from "./copy-machine"
import { createDispatch } from "./dispatch"
import { createPairingState, pairingEffectFailed, transitionPairing, type PairingEffect } from "./machine"

// A rejection reaches its handler one microtask later.
const flush = () => Promise.resolve()

describe("createDispatch", () => {
  test("an effect that throws reports its failure, and later events still apply", async () => {
    const ran: PairingEffect["type"][] = []
    const box = { state: createPairingState() }

    const dispatch = createDispatch({
      read: () => box.state,
      write: (state) => void (box.state = state),
      transition: transitionPairing,
      run: (effect) => {
        ran.push(effect.type)

        // `dialogs.open` or a client call that throws before it returns a promise.
        if (effect.type === "read-remote" || effect.type === "open-dialog") throw new Error("Ipc is gone")
      },
      failed: pairingEffectFailed,
    })

    dispatch({ type: "server.changed", available: true })
    dispatch({ type: "main.changed", main: { status: "active", generation: 1 } })
    await flush()

    // The read that threw counts as a failed read, which waits and tries again.
    expect(box.state.remote).toMatchObject({ status: "loading", step: "waiting", failures: 1 })

    dispatch({ type: "dialog.opened" })
    await flush()

    // The dialog that never opened reads as closed, so Pair device opens it again.
    expect(box.state.dialog).toEqual({ status: "closed" })
    expect(ran).toEqual(["read-remote", "abort", "wait", "open-dialog"])

    dispatch({ type: "dialog.opened" })

    expect(box.state.dialog).toEqual({ status: "turning-on" })

    dispatch({ type: "disposed" })

    expect(box.state.remote).toEqual({ status: "disposed" })
  })

  test("an event an effect dispatches synchronously applies after the current one", () => {
    const order: string[] = []
    const box = { state: createCopyState() }

    const dispatch = createDispatch({
      read: () => box.state,
      write: (state) => void (box.state = state),
      transition: transitionCopy,
      run: (effect) => {
        order.push(`${effect.type}:${box.state.status}`)

        if (effect.type === "write") dispatch({ type: "copy.succeeded", attempt: effect.attempt })
      },
      failed: copyEffectFailed,
    })

    dispatch({ type: "copy.requested", url: "https://pair.example/auth/connect/a" })

    expect(order).toEqual(["cancel-timer:copying", "write:copying", "cancel-timer:copied", "schedule-feedback:copied"])
    expect(box.state).toMatchObject({ status: "copied", attempt: 1 })
  })
})
