import { describe, expect, test } from "bun:test"
import { formatInventoryAnswer } from "../src/inventory-answer"
import { mapInventoryRows, type ProductRow } from "../src/inventory-mapper"

const product: ProductRow = {
  productID: "run-1:2",
  name: "6001ZZ",
  spec: "12*28*8",
  attribute: "清油",
  remark: "xxx",
  supplier: "虎旺",
  totalInventory: "200.00000000",
}

describe("mapInventoryRows", () => {
  test("uses only the authoritative origin as supplier and hides the standard identity", () => {
    const items = mapInventoryRows({
      products: [product],
      shelves: [
        { productID: "run-1:2", shelfCode: "B-11-13" },
        { productID: "run-1:2", shelfCode: "B-11-13" },
      ],
    })

    expect(items).toEqual([
      {
        name: "6001ZZ",
        attribute: "清油",
        size: "12×28×8",
        shelves: ["B-11-13"],
        supplier: "虎旺",
        inventory: "200",
        remark: "xxx",
      },
    ])
    expect(formatInventoryAnswer(items)).toBe(
      "6001ZZ（清油）（12×28×8）（货架号：B-11-13）虎旺库存200，备注：xxx",
    )
    expect(JSON.stringify(items)).not.toContain("run-1:2")
  })

  test("omits supplier only when the approved origin is blank", () => {
    expect(
      mapInventoryRows({ products: [{ ...product, supplier: null }], shelves: [] }),
    ).toEqual([
      {
        name: "6001ZZ",
        attribute: "清油",
        size: "12×28×8",
        shelves: [],
        inventory: "200",
        remark: "xxx",
      },
    ])
  })

  test("preserves duplicate visible names as separate standard identities", () => {
    expect(
      mapInventoryRows({
        products: [
          { ...product, productID: "run-1:2", totalInventory: "150" },
          { ...product, productID: "run-1:10", totalInventory: "70" },
        ],
        shelves: [],
      }).map((item) => item.inventory),
    ).toEqual(["150", "70"])
  })

  test("does not parse a shelf from approved attributes or remarks", () => {
    expect(
      mapInventoryRows({
        products: [{ ...product, attribute: "B-11-13", remark: "A-1-1" }],
        shelves: [],
      }),
    ).toEqual([
      {
        name: "6001ZZ",
        size: "12×28×8",
        shelves: [],
        supplier: "虎旺",
        inventory: "200",
        remark: "A-1-1",
      },
    ])
  })

  test("fails the whole mapping for malformed quantities", () => {
    expect(() =>
      mapInventoryRows({
        products: [{ ...product, totalInventory: "200件" }],
        shelves: [],
      }),
    ).toThrow("inventory row contract mismatch")
  })
})
