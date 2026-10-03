import { describe, expect, test } from "bun:test"
import { getDialogModelSize } from "../../src/component/dialog-model"

describe("dialog model sizing", () => {
  test("returns xlarge for terminals with width >= 128", () => {
    expect(getDialogModelSize(128)).toBe("xlarge")
    expect(getDialogModelSize(160)).toBe("xlarge")
    expect(getDialogModelSize(200)).toBe("xlarge")
  })

  test("returns large for terminals with width >= 96 and < 128", () => {
    expect(getDialogModelSize(96)).toBe("large")
    expect(getDialogModelSize(100)).toBe("large")
    expect(getDialogModelSize(127)).toBe("large")
  })

  test("returns medium for terminals with width < 96", () => {
    expect(getDialogModelSize(95)).toBe("medium")
    expect(getDialogModelSize(80)).toBe("medium")
    expect(getDialogModelSize(60)).toBe("medium")
  })
})
