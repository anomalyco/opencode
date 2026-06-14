/**
 * @spec-handoff
 * @interface buildArchivedSessionEntries(sessions: Session[], fallbackTitle: string): ArchivedEntry[]
 *   - `Session` is the SDK type from "@opencode-ai/sdk/v2/client".
 *   - `sessions` is the array returned by `client.session.list({ archived: true, roots: true })`.
 *   - Real fields consumed (verified against packages/sdk/js/src/v2/gen/types.gen.ts):
 *       id: string
 *       parentID?: string
 *       title: string            (may be empty "" in practice; treat empty as missing)
 *       directory: string        (the project/working directory shown in the row)
 *       time: { created: number; updated: number; compacting?: number; archived?: number }
 * @returns ArchivedEntry[] where ArchivedEntry = {
 *       id: string               // session.id
 *       title: string            // session.title, or fallbackTitle when missing/empty
 *       directory: string        // session.directory (project context for the row)
 *       archivedAt: number       // session.time.archived (the archived timestamp)
 *       session: Session         // raw session passthrough for the unarchive+open action
 *   }
 * @behavior
 *   - Root-only: sessions WITH a `parentID` (children) are EXCLUDED; only roots appear.
 *   - Archived-only: a session whose `time.archived` is `undefined` is EXCLUDED (not archived).
 *   - Sort: entries sorted by `archivedAt` DESCENDING (most-recently-archived first), with an
 *     explicit STABLE tie-break by `id` ASCENDING when two roots share the same `archivedAt`.
 *     Relying on input order / ES stable-sort for ties is non-deterministic across fetch orders;
 *     the secondary key (`a.id.localeCompare(b.id)` / id ascending) makes the order reproducible.
 *   - Fallback title: missing or empty `title` → `fallbackTitle`.
 *   - Directory preserved: each entry exposes `session.directory` verbatim.
 *   - Raw passthrough: `entry.session` is the original session reference.
 * @edge-cases
 *   - Empty input `[]` → `[]` (drives the dialog empty state).
 *   - Epoch-0 timestamp: `time.archived === 0` is a VALID archived entry — it MUST be
 *     retained (use `!= null` / explicit undefined check, NOT a falsy check) and its
 *     `archivedAt` is `0`. Critical edge case from prior gotchas.
 *     Distinction: `archived: 0` is archived; `archived: undefined` is NOT archived.
 * @see ./browse-archived.ts (implementation — Kou)
 * @see packages/app/src/pages/layout/helpers.ts (isSessionArchived: `archived != null`)
 */
import { describe, expect, test } from "bun:test"
import { type Session } from "@opencode-ai/sdk/v2/client"
import { buildArchivedSessionEntries, type ArchivedEntry } from "./browse-archived"

const FALLBACK = "Untitled session"

// Builds a real-shaped SDK Session with only the fields the helper reads varied per case.
// `time` and `title` are passed through verbatim so empty/undefined values reach the helper.
function session(overrides: Partial<Session> & { id: string; time: Session["time"] }): Session {
  return {
    slug: overrides.id,
    projectID: "project-1",
    directory: "/work/project-1",
    title: "Default title",
    version: "1.0.0",
    ...overrides,
  } as Session
}

describe("buildArchivedSessionEntries", () => {
  test("excludes child sessions, keeping only archived roots", () => {
    const result = buildArchivedSessionEntries(
      [
        session({ id: "root", title: "Root", time: { created: 1, updated: 1, archived: 100 } }),
        session({ id: "child", parentID: "root", title: "Child", time: { created: 2, updated: 2, archived: 200 } }),
      ],
      FALLBACK,
    )

    expect(result.map((entry) => entry.id)).toEqual(["root"])
  })

  test("sorts entries by archivedAt descending", () => {
    const result = buildArchivedSessionEntries(
      [
        session({ id: "old", time: { created: 0, updated: 0, archived: 100 } }),
        session({ id: "newest", time: { created: 0, updated: 0, archived: 300 } }),
        session({ id: "middle", time: { created: 0, updated: 0, archived: 200 } }),
      ],
      FALLBACK,
    )

    expect(result.map((entry) => entry.id)).toEqual(["newest", "middle", "old"])
    expect(result.map((entry) => entry.archivedAt)).toEqual([300, 200, 100])
  })

  test("uses fallbackTitle when title is empty", () => {
    const [entry] = buildArchivedSessionEntries(
      [session({ id: "s1", title: "", time: { created: 0, updated: 0, archived: 100 } })],
      FALLBACK,
    )

    expect(entry.title).toBe(FALLBACK)
  })

  test("uses fallbackTitle when title is missing", () => {
    const [entry] = buildArchivedSessionEntries(
      [session({ id: "s1", title: undefined as unknown as string, time: { created: 0, updated: 0, archived: 100 } })],
      FALLBACK,
    )

    expect(entry.title).toBe(FALLBACK)
  })

  test("returns an empty array for empty input", () => {
    expect(buildArchivedSessionEntries([], FALLBACK)).toEqual([])
  })

  test("retains a session whose archived timestamp is epoch-0", () => {
    const result = buildArchivedSessionEntries(
      [session({ id: "epoch", title: "Epoch", time: { created: 0, updated: 0, archived: 0 } })],
      FALLBACK,
    )

    expect(result.map((entry) => entry.id)).toEqual(["epoch"])
    expect(result[0].archivedAt).toBe(0)
  })

  test("excludes a session whose archived timestamp is undefined", () => {
    const result = buildArchivedSessionEntries(
      [
        session({ id: "archived", time: { created: 0, updated: 0, archived: 100 } }),
        session({ id: "active", time: { created: 0, updated: 0, archived: undefined } }),
      ],
      FALLBACK,
    )

    expect(result.map((entry) => entry.id)).toEqual(["archived"])
  })

  test("preserves the session directory for project context", () => {
    const [entry] = buildArchivedSessionEntries(
      [session({ id: "s1", directory: "/home/me/code/widgets", time: { created: 0, updated: 0, archived: 100 } })],
      FALLBACK,
    )

    expect(entry.directory).toBe("/home/me/code/widgets")
  })

  test("exposes the raw session for the unarchive+open action", () => {
    const input = session({ id: "s1", time: { created: 0, updated: 0, archived: 100 } })
    const [entry] = buildArchivedSessionEntries([input], FALLBACK)

    expect(entry.session).toBe(input)
  })

  test("returns entries matching the ArchivedEntry contract", () => {
    const input = session({
      id: "s1",
      title: "Quarterly report",
      directory: "/work/reports",
      time: { created: 0, updated: 0, archived: 42 },
    })

    const [entry] = buildArchivedSessionEntries([input], FALLBACK)
    const expected: ArchivedEntry = {
      id: "s1",
      title: "Quarterly report",
      directory: "/work/reports",
      archivedAt: 42,
      session: input,
    }

    expect(entry).toEqual(expected)
  })

  test("orders sessions with an equal archivedAt deterministically by id ascending", () => {
    // Tie-break (LOW) — GENUINE RED: two+ roots archived at the SAME timestamp must have a
    // STABLE, explicit order. The current comparator (b.archivedAt - a.archivedAt) returns 0 for
    // ties, so the order is whatever fetch order the input arrived in (ES stable sort). The
    // desired behavior is an explicit secondary sort by id ascending. Input here is in
    // reverse-id order; current code preserves it (sess_c, sess_b, sess_a) instead of sorting by
    // id, so this assertion is RED until Kou adds the tie-break.
    const result = buildArchivedSessionEntries(
      [
        session({ id: "sess_c", time: { created: 0, updated: 0, archived: 100 } }),
        session({ id: "sess_b", time: { created: 0, updated: 0, archived: 100 } }),
        session({ id: "sess_a", time: { created: 0, updated: 0, archived: 100 } }),
      ],
      FALLBACK,
    )

    expect(result.map((entry) => entry.id)).toEqual(["sess_a", "sess_b", "sess_c"])
  })

  test("breaks archivedAt ties by id while keeping more-recent groups first", () => {
    // Tie-break (LOW) — GENUINE RED: locks BOTH keys together. Primary key keeps the newer
    // (200) group ahead of the older (100) group; secondary key orders ties within each group by
    // id ascending. Each group's input is in reverse-id order, so current code emits
    // [newer_b, newer_a, older_b, older_a]; the explicit tie-break must emit
    // [newer_a, newer_b, older_a, older_b]. RED until the secondary sort exists.
    const result = buildArchivedSessionEntries(
      [
        session({ id: "newer_b", time: { created: 0, updated: 0, archived: 200 } }),
        session({ id: "older_b", time: { created: 0, updated: 0, archived: 100 } }),
        session({ id: "newer_a", time: { created: 0, updated: 0, archived: 200 } }),
        session({ id: "older_a", time: { created: 0, updated: 0, archived: 100 } }),
      ],
      FALLBACK,
    )

    expect(result.map((entry) => entry.id)).toEqual(["newer_a", "newer_b", "older_a", "older_b"])
  })
})
