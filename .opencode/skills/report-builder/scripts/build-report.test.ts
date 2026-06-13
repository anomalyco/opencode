import { test, expect } from "bun:test"
import { render, parseReportData } from "./build-report"
import { SkillSafetyError, assertLocalSource } from "../../lib/index"

test("renders a markdown table from local data", () => {
  const markdown = render({
    title: "Q2 Review",
    generatedFor: "Acme",
    rows: [
      { label: "Revenue", value: 1200 },
      { label: "Churn", value: "2%" },
    ],
  })
  expect(markdown).toContain("# Q2 Review")
  expect(markdown).toContain("_For: Acme_")
  expect(markdown).toContain("| Revenue | 1200 |")
  expect(markdown).toContain("| Churn | 2% |")
})

test("parseReportData rejects malformed input", () => {
  expect(() => parseReportData({})).toThrow(SkillSafetyError)
  expect(() => parseReportData({ title: "x", rows: [{ label: 1, value: 2 }] })).toThrow(SkillSafetyError)
})

test("a remote --in source is refused", () => {
  expect(() => assertLocalSource("https://api.example.com/data.json")).toThrow(SkillSafetyError)
})
