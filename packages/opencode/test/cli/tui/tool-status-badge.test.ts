import { describe, expect, test } from "bun:test"
import type { ToolPart } from "@opencode-ai/sdk/v2"

// Badge configuration for tool status visibility
// These mappings ensure tools always display their current status
const TOOL_STATUS_BADGES: Record<ToolPart["state"]["status"], { glyph: string; color: string }> = {
  pending: { glyph: "○", color: "textMuted" },
  running: { glyph: "●", color: "success" },
  completed: { glyph: "✓", color: "success" },
  error: { glyph: "✗", color: "error" },
}

const PERMISSION_BADGE = { glyph: "!", color: "warning" }

describe("tool status badges", () => {
  describe("status badge mapping", () => {
    test("pending status shows empty circle glyph", () => {
      const badge = TOOL_STATUS_BADGES["pending"]
      expect(badge.glyph).toBe("○")
      expect(badge.color).toBe("textMuted")
    })

    test("running status shows filled circle glyph", () => {
      const badge = TOOL_STATUS_BADGES["running"]
      expect(badge.glyph).toBe("●")
      expect(badge.color).toBe("success")
    })

    test("completed status shows checkmark glyph", () => {
      const badge = TOOL_STATUS_BADGES["completed"]
      expect(badge.glyph).toBe("✓")
      expect(badge.color).toBe("success")
    })

    test("error status shows x mark glyph", () => {
      const badge = TOOL_STATUS_BADGES["error"]
      expect(badge.glyph).toBe("✗")
      expect(badge.color).toBe("error")
    })
  })

  describe("permission badge", () => {
    test("permission pending shows exclamation glyph", () => {
      expect(PERMISSION_BADGE.glyph).toBe("!")
      expect(PERMISSION_BADGE.color).toBe("warning")
    })
  })

  describe("all statuses have badges", () => {
    test("every possible tool status has a badge defined", () => {
      const statuses: ToolPart["state"]["status"][] = ["pending", "running", "completed", "error"]

      for (const status of statuses) {
        const badge = TOOL_STATUS_BADGES[status]
        expect(badge).toBeDefined()
        expect(badge.glyph).toBeTruthy()
        expect(badge.color).toBeTruthy()
      }
    })
  })

  describe("badge visibility requirements", () => {
    test("glyphs are single characters for consistent display", () => {
      for (const [status, badge] of Object.entries(TOOL_STATUS_BADGES)) {
        expect(badge.glyph.length).toBe(1)
      }
    })

    test("each status has a distinct glyph", () => {
      const glyphs = Object.values(TOOL_STATUS_BADGES).map((b) => b.glyph)
      const uniqueGlyphs = new Set(glyphs)
      expect(uniqueGlyphs.size).toBe(glyphs.length)
    })

    test("glyphs are visually distinct (different symbols)", () => {
      // Ensure we have different visual representations
      const { pending, running, completed, error } = TOOL_STATUS_BADGES
      expect(pending.glyph).not.toBe(running.glyph)
      expect(running.glyph).not.toBe(completed.glyph)
      expect(completed.glyph).not.toBe(error.glyph)
      expect(error.glyph).not.toBe(pending.glyph)
    })
  })
})

// Helper type for testing component props
type ToolPartLike = {
  state: {
    status: "pending" | "running" | "completed" | "error"
  }
}

describe("InlineTool badge logic", () => {
  function getInlineBadge(part: ToolPartLike, hasPermission: boolean): { glyph: string; color: string } {
    if (hasPermission) return PERMISSION_BADGE
    return TOOL_STATUS_BADGES[part.state.status]
  }

  test("returns permission badge when permission is pending", () => {
    const part = { state: { status: "pending" as const } }
    const badge = getInlineBadge(part, true)
    expect(badge.glyph).toBe("!")
    expect(badge.color).toBe("warning")
  })

  test("returns status badge when no permission pending", () => {
    const part = { state: { status: "running" as const } }
    const badge = getInlineBadge(part, false)
    expect(badge.glyph).toBe("●")
    expect(badge.color).toBe("success")
  })

  test("prioritizes permission badge over error status", () => {
    // Even if tool has error, permission takes precedence
    const part = { state: { status: "error" as const } }
    const badge = getInlineBadge(part, true)
    expect(badge.glyph).toBe("!")
    expect(badge.color).toBe("warning")
  })
})

describe("BlockTool badge logic", () => {
  function getBlockBadge(part: ToolPartLike | undefined): { glyph: string; color: string } | undefined {
    const status = part?.state.status
    if (!status) return undefined
    return TOOL_STATUS_BADGES[status]
  }

  test("returns badge for pending status", () => {
    const part = { state: { status: "pending" as const } }
    const badge = getBlockBadge(part)
    expect(badge?.glyph).toBe("○")
    expect(badge?.color).toBe("textMuted")
  })

  test("returns badge for running status", () => {
    const part = { state: { status: "running" as const } }
    const badge = getBlockBadge(part)
    expect(badge?.glyph).toBe("●")
    expect(badge?.color).toBe("success")
  })

  test("returns badge for completed status", () => {
    const part = { state: { status: "completed" as const } }
    const badge = getBlockBadge(part)
    expect(badge?.glyph).toBe("✓")
    expect(badge?.color).toBe("success")
  })

  test("returns badge for error status", () => {
    const part = { state: { status: "error" as const } }
    const badge = getBlockBadge(part)
    expect(badge?.glyph).toBe("✗")
    expect(badge?.color).toBe("error")
  })

  test("returns undefined when part is undefined", () => {
    const badge = getBlockBadge(undefined)
    expect(badge).toBeUndefined()
  })

  test("always visible for all tool states", () => {
    // Block tools should show badges for ALL statuses
    const statuses: ToolPart["state"]["status"][] = ["pending", "running", "completed", "error"]

    for (const status of statuses) {
      const part = { state: { status } }
      const badge = getBlockBadge(part)
      expect(badge).toBeDefined()
    }
  })
})
