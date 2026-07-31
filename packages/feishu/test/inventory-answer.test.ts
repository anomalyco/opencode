import { describe, expect, test } from "bun:test"
import { formatInventoryAnswer, type InventoryAnswerItem } from "../src/inventory-answer"

describe("formatInventoryAnswer", () => {
  test("renders the approved complete sentence exactly", () => {
    expect(
      formatInventoryAnswer([
        {
          name: "6001ZZ",
          attribute: "清油",
          size: "12*28*8",
          shelves: ["B-11-13"],
          supplier: "上海涂众轴承",
          inventory: "200",
          remark: "xxx",
        },
      ]),
    ).toBe("6001ZZ（清油）（12×28×8）（货架号：B-11-13）上海涂众轴承库存200，备注：xxx")
  })

  test("omits missing optional fields and unattributed wording", () => {
    expect(
      formatInventoryAnswer([
        {
          name: "6001ZZ",
          shelves: [],
          inventory: "200",
        },
      ]),
    ).toBe("6001ZZ库存200")
  })

  test("keeps one result per line and normalizes shelves and remarks", () => {
    expect(
      formatInventoryAnswer([
        {
          name: "6001ZZ",
          size: "12X28x8",
          shelves: ["B-11-13", "B-11-2", "B-11-13"],
          inventory: "200",
          remark: "第一行\r\n第二行",
        },
        {
          name: "6201",
          shelves: [],
          inventory: "8",
        },
      ]),
    ).toBe("6001ZZ（12×28×8）（货架号：B-11-13、B-11-2）库存200，备注：第一行 第二行\n6201库存8")
  })

  test("ignores extra internal fields at runtime", () => {
    const item = {
      name: "6001ZZ",
      shelves: [],
      inventory: "200",
      productID: "2694",
      u_Code: "SP0000005943",
    } as InventoryAnswerItem & {
      productID: string
      u_Code: string
    }

    expect(formatInventoryAnswer([item])).toBe("6001ZZ库存200")
  })

  test("returns the fixed no-result sentence", () => {
    expect(formatInventoryAnswer([])).toBe("未找到相关商品。")
  })
})
