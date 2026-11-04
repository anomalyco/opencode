import { expect, test } from "bun:test"
import { recoverPendingRequests, REQUEST_RECOVERY_MAX_SESSIONS, type RequestRecoverySource } from "./request-recovery"

type Form = { id: string; metadata?: { kind?: string } }

type Permission = { id: string }

// A fake request store whose server holds requests the client never received as events.
function fakeSource(input: {
  active: string[]
  forms?: Record<string, Form[]>
  permissions?: Record<string, Permission[]>
}) {
  const loadedForms: Record<string, Form[]> = {}
  const loadedPermissions: Record<string, Permission[]> = {}
  const calls: string[] = []

  const source: RequestRecoverySource = {
    active: async () => input.active,
    form: {
      invalidate: (id) => {
        calls.push(`form.invalidate:${id}`)
      },
      sync: async (id) => {
        calls.push(`form.sync:${id}`)
        loadedForms[id] = input.forms?.[id] ?? []
      },
      list: (id) => loadedForms[id],
    },
    permission: {
      invalidate: (id) => {
        calls.push(`permission.invalidate:${id}`)
      },
      sync: async (id) => {
        calls.push(`permission.sync:${id}`)
        loadedPermissions[id] = input.permissions?.[id] ?? []
      },
      list: (id) => loadedPermissions[id],
    },
  }

  return { source, calls }
}

test("reports a question whose live event was missed", async () => {
  const { source, calls } = fakeSource({
    active: ["ses_a"],
    forms: { ses_a: [{ id: "frm_q", metadata: { kind: "question" } }] },
  })

  const seen: string[] = []

  await recoverPendingRequests(source, (kind, sessionID, requestID) => seen.push(`${kind}:${sessionID}:${requestID}`))
  expect(seen).toEqual(["question:ses_a:frm_q"])
  // Cached loads must be invalidated first, or a stale empty list would hide the request.
  expect(calls.indexOf("form.invalidate:ses_a")).toBeLessThan(calls.indexOf("form.sync:ses_a"))
  expect(calls.indexOf("permission.invalidate:ses_a")).toBeLessThan(calls.indexOf("permission.sync:ses_a"))
})

test("reports permissions and other dock forms, but not unrelated forms", async () => {
  const { source } = fakeSource({
    active: ["ses_a", "ses_b"],
    forms: {
      ses_a: [
        { id: "frm_w", metadata: { kind: "websearch.provider" } },
        { id: "frm_x", metadata: { kind: "provider.oauth" } },
        { id: "frm_none" },
      ],
      ses_b: [{ id: "frm_e", metadata: { kind: "mcp-elicitation" } }],
    },
    permissions: { ses_b: [{ id: "per_1" }] },
  })

  const seen: string[] = []

  await recoverPendingRequests(source, (kind, sessionID, requestID) => seen.push(`${kind}:${sessionID}:${requestID}`))
  expect(seen).toEqual(["websearch.provider:ses_a:frm_w", "mcp-elicitation:ses_b:frm_e", "permission:ses_b:per_1"])
})

test("one failing session does not stop the others", async () => {
  const { source } = fakeSource({
    active: ["ses_bad", "ses_ok"],
    forms: { ses_ok: [{ id: "frm_q", metadata: { kind: "question" } }] },
  })

  const sync = source.form.sync

  source.form.sync = (id) => (id === "ses_bad" ? Promise.reject(new Error("gone")) : sync(id))

  const seen: string[] = []

  await recoverPendingRequests(source, (_kind, sessionID) => seen.push(sessionID))
  expect(seen).toEqual(["ses_ok"])
})

test("checks no sessions when none run, and bounds a large set", async () => {
  const idle = fakeSource({ active: [] })

  expect(await recoverPendingRequests(idle.source, () => undefined)).toBe(0)
  expect(idle.calls).toEqual([])

  const many = Array.from({ length: REQUEST_RECOVERY_MAX_SESSIONS + 10 }, (_, index) => `ses_${index}`)
  const busy = fakeSource({ active: many })

  expect(await recoverPendingRequests(busy.source, () => undefined)).toBe(REQUEST_RECOVERY_MAX_SESSIONS)
})
