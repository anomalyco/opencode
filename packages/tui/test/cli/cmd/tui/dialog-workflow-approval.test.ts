import { describe, expect, it } from "bun:test"
import {
  approvalDecision,
  createApprovalStack,
  isSessionApproved,
  rememberSessionApproval,
  type ApprovalDialogStack,
  type WorkflowApprovalResult,
} from "../../../../src/component/dialog-workflow-approval-helpers"

// Fake dialog stack that records the single current item (replace overwrites it,
// matching the real stack's single-slot replace) and lets a test re-fire the
// recorded onClose to simulate a backdrop / Esc dismissal. notifyClose:false on
// a replace means the OUTGOING item's onClose must NOT fire — exactly the bug we
// guard against (previewing the script resolving the start as "cancel").
function fakeDialog() {
  let current: { onClose?: () => void | boolean } | undefined
  const events: string[] = []
  const dialog: ApprovalDialogStack = {
    replace(_element, onClose, options) {
      events.push(options?.notifyClose === false ? "replace(notifyClose:false)" : "replace")
      if (options?.notifyClose !== false && current?.onClose) current.onClose()
      current = { onClose }
    },
    clear() {
      events.push("clear")
      if (current?.onClose) current.onClose()
      current = undefined
    },
  }
  return {
    dialog,
    events,
    // Mimic a backdrop / Esc dismissal of whatever is on top of the stack.
    dismissCurrent() {
      if (current?.onClose) current.onClose()
    },
  }
}

function makeStack() {
  let result: WorkflowApprovalResult | "pending" = "pending"
  const fake = fakeDialog()
  const controller = createApprovalStack({
    dialog: fake.dialog,
    resolve: (r) => {
      result = r
    },
    renderApproval: () => () => "<approval/>",
    renderSource: () => () => "<source/>",
  })
  return { controller, fake, result: () => result }
}

describe("workflow approval", () => {
  it("never → kein Dialog", () => {
    expect(approvalDecision({ mode: "never", alreadyApproved: false })).toBe("start")
  })
  it("first-run → Dialog nur ohne gespeicherte Zustimmung", () => {
    expect(approvalDecision({ mode: "first-run", alreadyApproved: false })).toBe("ask")
    expect(approvalDecision({ mode: "first-run", alreadyApproved: true })).toBe("start")
  })
  it("always → immer Dialog", () => {
    expect(approvalDecision({ mode: "always", alreadyApproved: true })).toBe("ask")
  })

  // Edge cases beyond the canonical matrix.
  it("never starts even when not yet approved", () => {
    expect(approvalDecision({ mode: "never", alreadyApproved: true })).toBe("start")
  })
  it("always asks even on the very first run", () => {
    expect(approvalDecision({ mode: "always", alreadyApproved: false })).toBe("ask")
  })
  it("defaults to first-run semantics when mode is undefined", () => {
    expect(approvalDecision({ mode: undefined, alreadyApproved: false })).toBe("ask")
    expect(approvalDecision({ mode: undefined, alreadyApproved: true })).toBe("start")
  })
})

describe("approval stack choreography", () => {
  it("opening the source pager does NOT resolve the start", () => {
    const { controller, fake, result } = makeStack()
    controller.showApproval()
    controller.showSource()
    // The swap must use notifyClose:false so the approval item's onClose
    // (= decide("cancel")) does not fire while merely previewing the script.
    expect(fake.events).toEqual(["replace", "replace(notifyClose:false)"])
    expect(result()).toBe("pending")
  })

  it("back from the pager then Yes resolves exactly once as 'once'", () => {
    const { controller, fake, result } = makeStack()
    controller.showApproval()
    controller.showSource()
    controller.back()
    controller.commit("once")
    expect(result()).toBe("once")
    // The clear's onClose (decide("cancel")) must be a no-op after commit.
    expect(fake.events).toEqual(["replace", "replace(notifyClose:false)", "replace(notifyClose:false)", "clear"])
  })

  it("a backdrop dismiss INSIDE the pager resolves 'cancel'", () => {
    const { controller, fake, result } = makeStack()
    controller.showApproval()
    controller.showSource()
    // Dismiss the pager (its own onClose must be wired to decide("cancel"), not
    // left undefined which would hang the start promise forever).
    fake.dismissCurrent()
    expect(result()).toBe("cancel")
  })

  it("a backdrop dismiss of the approval screen resolves 'cancel'", () => {
    const { controller, fake, result } = makeStack()
    controller.showApproval()
    fake.dismissCurrent()
    expect(result()).toBe("cancel")
  })

  it("the first decision wins; later calls are no-ops", () => {
    const { controller, result } = makeStack()
    controller.showApproval()
    controller.commit("always")
    controller.commit("once")
    controller.decide("cancel")
    expect(result()).toBe("always")
  })
})

describe("session-local approval cache", () => {
  it("records and reports a freshly approved workflow", () => {
    const name = `wf-${Math.random().toString(36).slice(2)}`
    expect(isSessionApproved(name)).toBe(false)
    rememberSessionApproval(name)
    expect(isSessionApproved(name)).toBe(true)
  })
})
