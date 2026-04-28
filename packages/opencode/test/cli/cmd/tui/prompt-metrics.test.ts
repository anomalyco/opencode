import { describe, expect, test } from "bun:test"
import {
  formatCodexQuotaFetchedAt,
  formatCodexQuotaMetrics,
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
})
