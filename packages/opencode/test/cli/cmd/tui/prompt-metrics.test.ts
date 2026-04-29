import { describe, expect, test } from "bun:test"
import {
  formatCodexQuotaFetchedAt,
  formatCodexQuotaMetrics,
  formatProviderQuotaMetrics,
  formatQuotaBar,
} from "../../../../src/cli/cmd/tui/component/prompt/metrics"

const fetchedAt = new Date(2026, 3, 28, 17, 38, 30).getTime()
const sameDay = new Date(2026, 3, 28, 20, 0, 0).getTime()

describe("prompt metrics", () => {
  test("formats codex quota with full bars on wide terminals", () => {
    expect(
      formatCodexQuotaMetrics(
        {
          fiveHour: { remainingPercent: 90 },
          weekly: { remainingPercent: 95 },
          fetchedAt,
        },
        200,
        sameDay,
      ),
    ).toBe("codex 5h █████████░ 90% · wk ██████████ 95% · ⟳ today@17h38m30s")
  })

  test("formats codex quota with compact bars on medium terminals", () => {
    expect(
      formatCodexQuotaMetrics(
        {
          fiveHour: { remainingPercent: 90 },
          weekly: { remainingPercent: 95 },
          fetchedAt,
        },
        120,
        sameDay,
      ),
    ).toBe("codex 5h █████ 90% · wk █████ 95% · ⟳ today@17h38m30s")
  })

  test("falls back to percentages as terminal width tightens", () => {
    const quota = {
      fiveHour: { remainingPercent: 90 },
      weekly: { remainingPercent: 95 },
      fetchedAt,
    }

    expect(formatCodexQuotaMetrics(quota, 90, sameDay)).toBe("codex 5h 90% · wk 95% · ⟳ today@17h38m30s")
    expect(formatCodexQuotaMetrics(quota, 89, sameDay)).toBe("codex 5h 90% · wk 95%")
  })

  test("rounds and clamps quota bar percentages", () => {
    expect(formatQuotaBar(87.5, 5)).toBe("████░")
    expect(formatQuotaBar(-10, 5)).toBe("░░░░░")
    expect(formatQuotaBar(120, 5)).toBe("█████")
  })

  test("formats refresh timestamps and drops invalid values", () => {
    expect(formatCodexQuotaFetchedAt(fetchedAt, new Date(2026, 3, 28, 20, 0, 0).getTime())).toBe(
      "today@17h38m30s",
    )
    expect(formatCodexQuotaFetchedAt(fetchedAt, new Date(2026, 3, 29, 20, 0, 0).getTime())).toBe(
      "yesterday@17h38m30s",
    )
    expect(formatCodexQuotaFetchedAt(fetchedAt, new Date(2026, 3, 30, 20, 0, 0).getTime())).toBe(
      "2d ago@17h38m30s",
    )

    expect(
      formatCodexQuotaMetrics(
        {
          fiveHour: { remainingPercent: 87.5 },
          fetchedAt: Number.NaN,
        },
        120,
        sameDay,
      ),
    ).toBe("codex 5h ████░ 88%")
  })

  test("formats provider quota snapshots and skips estimated or unavailable windows", () => {
    expect(
      formatProviderQuotaMetrics(
        [
          {
            provider: "copilot",
            label: "copilot",
            fetchedAt: fetchedAt,
            status: "available",
            windows: [
              {
                label: "wk",
                confidence: "estimated",
                remainingPercent: 58,
                source: "heuristic",
              },
            ],
          },
          {
            provider: "anthropic",
            label: "anthropic",
            fetchedAt: fetchedAt,
            status: "unavailable",
            windows: [
              {
                label: "req",
                confidence: "reported",
                remainingPercent: 0,
                source: "response_headers",
              },
            ],
          },
          {
            provider: "codex",
            label: "codex",
            fetchedAt: fetchedAt,
            status: "available",
            windows: [
              {
                label: "5h",
                confidence: "exact",
                remainingPercent: 97,
                source: "official_api",
              },
              {
                label: "wk",
                confidence: "reported",
                remainingPercent: 90,
                source: "response_headers",
              },
            ],
          },
        ],
        120,
        sameDay,
      ),
    ).toBe("codex 5h 97% · wk 90% · ⟳ today@17h38m30s")
  })

  test("prioritizes the active provider quota", () => {
    expect(
      formatProviderQuotaMetrics(
        [
          {
            provider: "codex",
            label: "codex",
            fetchedAt,
            status: "available",
            windows: [
              {
                label: "5h",
                confidence: "exact",
                remainingPercent: 97,
                source: "official_api",
              },
            ],
          },
          {
            provider: "anthropic",
            label: "anthropic",
            fetchedAt,
            status: "available",
            windows: [
              {
                label: "req",
                confidence: "reported",
                remainingPercent: 82,
                source: "response_headers",
              },
            ],
          },
        ],
        80,
        sameDay,
        "anthropic",
      ),
    ).toBe("anthropic req 82%")
  })
})
