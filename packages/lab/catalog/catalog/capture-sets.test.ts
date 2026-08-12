import { describe, expect, test } from "bun:test"
import { resolve } from "node:path"
import {
  captureMatrixManifest,
  captureSetId,
  captureSetLabel,
  parseCaptureOptions,
} from "../scripts/capture-sets"

describe("capture revision sets", () => {
  test("parses repeated revisions and themes", () => {
    expect(parseCaptureOptions([
      "--opencode", "./opencode",
      "--revision", "v2~1",
      "--revision", "v2",
      "--theme", "opencode",
      "--theme", "rosepine",
    ], "/default")).toEqual({
      opencode: resolve("opencode"),
      revisions: ["v2~1", "v2"],
      themes: ["opencode", "rosepine"],
      flow: undefined,
      fresh: false,
      jobs: 3,
      workerOutput: undefined,
    })
  })

  test("defaults to the canonical v2 branch instead of a stale checkout HEAD", () => {
    expect(parseCaptureOptions([], "/opencode").revisions).toEqual(["origin/v2"])
  })

  test("selects one flow and deliberately refreshes its prepared worktree", () => {
    expect(parseCaptureOptions(["--flow", "search-lifecycle", "--fresh"], "/opencode")).toMatchObject({
      flow: "search-lifecycle",
      fresh: true,
    })
  })

  test("derives stable theme IDs and labels", () => {
    expect(captureSetId("ABCDEF1234567890", undefined)).toBe("abcdef123456")
    expect(captureSetId("ABCDEF1234567890", "One Dark")).toBe("one-dark")
    expect(captureSetId("ABCDEF1234567890", "One Dark", true)).toBe("abcdef123456-one-dark")
    expect(captureSetLabel("abcdef1234567890", "opencode")).toBe("Opencode")
    expect(captureSetLabel("abcdef1234567890", "tokyonight")).toBe("Tokyo Night")
    expect(captureSetLabel("abcdef1234567890", "everforest")).toBe("Everforest")
  })

  test("publishes only the requested theme matrix", () => {
    const variant = {
      id: "opencode",
      label: "Opencode",
      source: "opencode",
      revision: "a".repeat(40),
      ref: "HEAD",
      committedAt: "2026-08-12T12:00:00Z",
      theme: "opencode",
    }
    const manifest = captureMatrixManifest([variant], [{
      id: "home",
      title: "Home",
      category: "system",
      frames: [{ variantId: "opencode", src: "captures/opencode/home.frame.json", cols: 2, rows: 2 }],
    }])

    expect(manifest.variants).toEqual([variant])
    expect(manifest.captures[0]?.frames).toEqual([
      { variantId: "opencode", src: "captures/opencode/home.frame.json", cols: 2, rows: 2 },
    ])
  })
})
