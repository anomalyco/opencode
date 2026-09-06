import { describe, expect, test } from "bun:test"
import { AttachmentStatus } from "@/session/attachment/status"
import { ASYNC_TASK_PROTOCOL, ASYNC_TASK_STATUS } from "@/tool/task-protocol"

/**
 * The attached-async status observation.
 *
 * These assert `AttachmentStatus` directly rather than through provider lowering. The status line is
 * model-facing guidance, not delivery proof: the return gate is runtime logic in the coordinator, and
 * by this module's own design note a missed or early status "costs only another wait decision and
 * never changes attachment settlement". So what is worth pinning is the observation rule and the
 * shape of the suffix it produces, both of which are decided here.
 */
describe("attached async status observation", () => {
  test("the Task protocol names the status line the prompt path emits", () => {
    expect(ASYNC_TASK_STATUS).toBe("[attached async tasks: 0]")
    expect(Buffer.byteLength(ASYNC_TASK_STATUS, "utf8")).toBe(25)
    // `AttachmentStatus.suffix` has a production consumer: `session/prompt.ts` appends it to the
    // request `messageSuffix`. Because a route emits it, the protocol may name it back to the model
    // — a prompt that names a runtime signal is a claim about the runtime, and this claim is true.
    // If that wiring is ever removed, this assertion is what fails.
    expect(ASYNC_TASK_PROTOCOL).toContain(ASYNC_TASK_STATUS)
    // Positive control. Without it the assertion above would pass against a protocol string that is
    // nothing but the literal, proving only that concatenation works. This also pins the guarantee
    // the status line is advisory to: the gate is runtime logic in the coordinator, and the text
    // still has to describe it independently of any signal.
    expect(ASYNC_TASK_PROTOCOL).toContain("a turn-end response is a yield")
    expect(ASYNC_TASK_PROTOCOL).toContain(
      "a called-agent's next turn-end response is relayed as the A2A-return to its caller-agent.",
    )
  })

  test("zero is observed from attachment lifetime facts, not provider coverage", () => {
    const base = { everAttached: true, attached: 0, undelivered: 0, failed: false, cancelled: false }
    expect(AttachmentStatus.observe(base)).toBe(true)
    // Each negative moves exactly one fact, so a passing positive above cannot be explained by an
    // observer that answers true unconditionally.
    expect(AttachmentStatus.observe({ ...base, attached: 1 })).toBe(false)
    expect(AttachmentStatus.observe({ ...base, undelivered: 1 })).toBe(false)
    expect(AttachmentStatus.observe({ ...base, failed: true })).toBe(false)
    expect(AttachmentStatus.observe({ ...base, cancelled: true })).toBe(false)
    expect(AttachmentStatus.observe({ ...base, everAttached: false })).toBe(false)
  })

  test("no observation produces no suffix at all", () => {
    // Absent rather than empty. An empty array would still be appended by a caller that checks only
    // for a value, putting a zero-length user turn on the request.
    expect(AttachmentStatus.suffix(false)).toBeUndefined()
  })

  test("a zero observation becomes one ordinary synthetic user message", () => {
    const suffix = AttachmentStatus.suffix(true)
    expect(suffix).toEqual([{ role: "user", content: [{ type: "text", text: ASYNC_TASK_STATUS }] }])
    // Exactly one, and an ordinary user turn: it carries no marker, so it is request-local by the
    // caller never persisting it rather than by any property of the message itself.
    expect(suffix).toHaveLength(1)
  })
})
