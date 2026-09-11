import { expect, test } from "bun:test"
import { createHomeIndexFixture, HOME_INDEX_VISIBLE_LIMIT } from "../timeline/home-session-index.fixture"

const now = 1_800_000_000_000

test("generates a deterministic index ordered like the server", () => {
  const fixture = createHomeIndexFixture({ count: 2_000, now })
  const again = createHomeIndexFixture({ count: 2_000, now })
  expect(again.sessions).toEqual(fixture.sessions)
  expect(fixture.sessions).toHaveLength(2_000)
  expect(new Set(fixture.sessions.map((session) => session.id)).size).toBe(2_000)
  const updated = fixture.sessions.map((session) => session.time.updated)
  expect(updated.every((time, index) => index === 0 || time > updated[index - 1])).toBe(true)
  expect(updated.every((time) => time <= now)).toBe(true)
  expect(fixture.sessions.every((session) => session.time.created < session.time.updated)).toBe(true)
  expect(fixture.expected.newestID).toBe(fixture.sessions[fixture.sessions.length - 1].id)
  expect(fixture.expected.visible).toBe(HOME_INDEX_VISIBLE_LIMIT)
})

test("spreads sessions across several directories with a skewed head", () => {
  const fixture = createHomeIndexFixture({ count: 5_000, now })
  const counts = Object.values(fixture.expected.perDirectory)
  expect(counts.reduce((sum, count) => sum + count, 0)).toBe(5_000)
  expect(fixture.directories).toHaveLength(12)
  expect(fixture.directories.filter((entry) => entry.project)).toHaveLength(8)
  const largest = Math.max(...counts)
  expect(largest).toBeGreaterThan(5_000 * 0.15)
  expect(Math.min(...counts)).toBeGreaterThan(0)
  expect(fixture.sessions.some((session) => session.time.updated > now - 86_400_000)).toBe(true)
  // Realistic serialized rows: hundreds of bytes each, not one-character stubs.
  expect(fixture.listBytes / 5_000).toBeGreaterThan(300)
})
