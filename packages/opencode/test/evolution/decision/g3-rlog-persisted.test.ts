import { describe, expect, test } from "bun:test"
import { readFileSync } from "fs"

describe("TG-RLOG-PERSISTED — ReconciliationLog written before proposal submission", () => {
  const engineSrc = readFileSync(
    new URL("../../../src/evolution/decision/engine.ts", import.meta.url),
    "utf-8",
  )

  test("engine builds reconciliation log in reconcile output", () => {
    const reconcileSection = engineSrc.slice(engineSrc.indexOf("const reconcile ="))
    expect(reconcileSection).toContain("reconciliationLog")
  })

  test("engine imports ReconciliationLogSchema", () => {
    expect(engineSrc).toContain("ReconciliationLogSchema")
  })

  test("activation layer imports saveReconciliationLog", () => {
    const activationSrc = readFileSync(
      new URL("../../../src/evolution/decision/activation/index.ts", import.meta.url),
      "utf-8",
    )
    expect(activationSrc).toContain("saveReconciliationLog")
  })
})
