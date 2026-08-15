import { expect, test } from "bun:test"
import { logoVariant } from "../src/component/logo"

test("adapts the logo to constrained terminals", () => {
  expect(logoVariant(19, 24)).toBe("compact")
  expect(logoVariant(21, 24)).toBe("compact")
  expect(logoVariant(22, 24)).toBe("stacked")
  expect(logoVariant(43, 24)).toBe("stacked")
  expect(logoVariant(44, 24)).toBe("full")
  expect(logoVariant(80, 11)).toBe("hidden")
})
