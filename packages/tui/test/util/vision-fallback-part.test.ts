import { describe, expect, test } from "bun:test"
import type { TextPart } from "@kancode/sdk/v2"
import {
  isVisionFallbackPart,
  visionFallbackLabel,
  visionFallbackParts,
  visionFallbackShouldCollapse,
} from "../../src/util/vision-fallback-part"

function textPart(input: Partial<TextPart> & { text: string }): TextPart {
  return {
    id: "prt_1",
    sessionID: "ses_1",
    messageID: "msg_1",
    type: "text",
    ...input,
  }
}

describe("util.vision-fallback-part", () => {
  test("detects metadata flag", () => {
    expect(
      isVisionFallbackPart(
        textPart({
          text: "A button",
          metadata: { visionFallback: true, providerID: "ollama", modelID: "gemma" },
        }),
      ),
    ).toBe(true)
    expect(isVisionFallbackPart(textPart({ text: "hi" }))).toBe(false)
  })

  test("filters vision fallback parts from a list", () => {
    const parts = [
      textPart({ text: "prompt" }),
      textPart({
        text: "desc",
        synthetic: true,
        ignored: true,
        metadata: { visionFallback: true, providerID: "a", modelID: "b", modality: "image" },
      }),
    ]
    expect(visionFallbackParts(parts)).toHaveLength(1)
  })

  test("builds label with target", () => {
    expect(
      visionFallbackLabel(
        textPart({
          text: "x",
          metadata: { visionFallback: true, providerID: "ollama-cloud", modelID: "gemma4:31b", modality: "image" },
        }) as never,
      ),
    ).toBe("Vision fallback · ollama-cloud/gemma4:31b")
    expect(
      visionFallbackLabel(
        textPart({
          text: "x",
          metadata: { visionFallback: true, modality: "pdf" },
        }) as never,
      ),
    ).toBe("Vision fallback")
  })

  test("collapses long bodies by default", () => {
    expect(visionFallbackShouldCollapse("short")).toBe(false)
    expect(visionFallbackShouldCollapse(["a", "b", "c", "d", "e"].join("\n"))).toBe(true)
    expect(visionFallbackShouldCollapse("x".repeat(241))).toBe(true)
  })
})
