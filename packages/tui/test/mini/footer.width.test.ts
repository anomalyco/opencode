import { describe, expect, test } from "bun:test"
import { footerStatuslinePolicy, footerWidthPolicy } from "../../src/mini/footer.width"

describe("run footer width", () => {
  test("preserves the dialog breakpoint", () => {
    expect(footerWidthPolicy(79).dialog.narrow).toBe(true)
    expect(footerWidthPolicy(80).dialog.narrow).toBe(false)
  })

  test.each([16, 20, 24, 32, 40, 56, 80, 112])("fits whole idle identity before commands at %i columns", (width) => {
    expect(
      footerStatuslinePolicy({
        width,
        mainWidth: 0,
        agentWidth: 5,
        modelWidth: 5,
        variantWidth: 4,
        commandWidth: 10,
        contextWidths: [],
      }),
    ).toMatchObject({ showAgent: true, showModel: true, showVariant: width >= 18, showCommand: width >= 31 })
  })

  test("running actions fit independently before identity", () => {
    expect(
      footerStatuslinePolicy({
        width: 32,
        mainWidth: 8,
        running: true,
        contextWidths: [40, 7],
        commandWidth: 10,
        agentWidth: 5,
        modelWidth: 5,
        spinnerWidth: 8,
      }),
    ).toMatchObject({
      context: [false, true],
      showCommand: true,
      showAgent: false,
      showModel: false,
      showSpinner: false,
    })
  })

  test("usage needs no spare headroom and precedes provider and spinner", () => {
    expect(
      footerStatuslinePolicy({
        width: 80,
        mainWidth: 0,
        agentWidth: 5,
        modelWidth: 44,
        usageWidth: 18,
        providerWidth: 8,
        spinnerWidth: 8,
        contextWidths: [],
      }),
    ).toMatchObject({ showUsage: true, showProvider: false, showSpinner: false })
  })

  test("a hidden model cannot leave an orphaned variant or provider", () => {
    expect(
      footerStatuslinePolicy({
        width: 24,
        mainWidth: 0,
        agentWidth: 40,
        modelWidth: 30,
        variantWidth: 2,
        providerWidth: 4,
        commandWidth: 10,
        contextWidths: [],
      }),
    ).toMatchObject({ showAgent: false, showModel: false, showVariant: false, showProvider: false, showCommand: true })
  })
})
