import { describe, expect, test } from "bun:test"
import { formatInventoryAnswer } from "../src/inventory-answer"
import { mapInventoryRows, type InventorySourceRow, type ProductRow } from "../src/inventory-mapper"

const product: ProductRow = {
  productID: "2694",
  name: "6001ZZ",
  spec: "轴承 12*28*8",
  attribute: "清油",
  remark: "xxx",
  totalInventory: "200.00000000",
}

function supplier(
  input: Partial<InventorySourceRow> & Pick<InventorySourceRow, "sourceRefID" | "supplierName" | "onHandQty">,
): InventorySourceRow {
  return {
    productID: "2694",
    sourceRefKind: "ERP",
    supplierID: input.sourceRefID,
    supplierLegacyID: null,
    supplierRole: "SUPPLIER",
    supplierEnabled: 1,
    supplierDeleted: 0,
    ...input,
  }
}

describe("mapInventoryRows", () => {
  test("maps the observed 6001ZZ row without an internal identifier", () => {
    const items = mapInventoryRows({
      products: [product],
      shelves: [
        { productID: "2694", shelfCode: "B-11-13" },
        { productID: "2694", shelfCode: "B-11-13" },
      ],
      sources: [],
    })

    expect(items).toEqual([
      {
        name: "6001ZZ",
        attribute: "清油",
        size: "12×28×8",
        shelves: ["B-11-13"],
        inventory: "200",
        remark: "xxx",
      },
    ])
    expect(JSON.stringify(items)).not.toContain("2694")
  })

  test("emits one deterministic item per active supplier source", () => {
    const sources = [
      supplier({
        sourceRefID: "supplier-b",
        supplierName: "乙供应商",
        onHandQty: "70.000000",
      }),
      supplier({
        sourceRefID: "supplier-a",
        supplierName: "甲供应商",
        onHandQty: "130.000000",
      }),
    ]

    expect(
      mapInventoryRows({ products: [product], shelves: [], sources }).map(
        (item) => `${item.supplier}:${item.inventory}`,
      ),
    ).toEqual(["甲供应商:130", "乙供应商:70"])
  })

  test("falls back to product total for unattributed or inactive sources", () => {
    const sources: InventorySourceRow[] = [
      {
        productID: "2694",
        sourceRefKind: "UNATTRIBUTED",
        sourceRefID: "UNATTRIBUTED",
        onHandQty: "200.000000",
        supplierID: null,
        supplierLegacyID: null,
        supplierName: null,
        supplierRole: null,
        supplierEnabled: null,
        supplierDeleted: null,
      },
      supplier({
        sourceRefID: "deleted-supplier",
        supplierName: "不可用供应商",
        onHandQty: "200.000000",
        supplierEnabled: 0,
        supplierDeleted: 1,
      }),
    ]

    expect(formatInventoryAnswer(mapInventoryRows({ products: [product], shelves: [], sources }))).toBe(
      "6001ZZ（清油）（12×28×8）库存200，备注：xxx",
    )
  })

  test("does not treat a shelf-only attribute or remark as another field", () => {
    expect(
      mapInventoryRows({
        products: [
          {
            ...product,
            attribute: "B-11-13、B-11-2",
            remark: "2024-7-20",
          },
        ],
        shelves: [{ productID: "2694", shelfCode: "B-11-13" }],
        sources: [],
      }),
    ).toEqual([
      {
        name: "6001ZZ",
        size: "12×28×8",
        shelves: ["B-11-13"],
        inventory: "200",
        remark: "2024-7-20",
      },
    ])
  })

  test("preserves duplicate visible names as separate product identities", () => {
    expect(
      mapInventoryRows({
        products: [
          { ...product, productID: "10", totalInventory: "70" },
          { ...product, productID: "2", totalInventory: "150" },
        ],
        shelves: [],
        sources: [],
      }).map((item) => item.inventory),
    ).toEqual(["150", "70"])
  })

  test("ignores negative supplier projections and uses the product total", () => {
    expect(
      mapInventoryRows({
        products: [product],
        shelves: [],
        sources: [
          supplier({
            sourceRefID: "negative-adjustment",
            supplierName: "调整项",
            onHandQty: "-1",
          }),
        ],
      }),
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

  test("fails the whole mapping for malformed quantities", () => {
    expect(() =>
      mapInventoryRows({
        products: [{ ...product, totalInventory: "200件" }],
        shelves: [],
        sources: [],
      }),
    ).toThrow("inventory row contract mismatch")

    expect(() =>
      mapInventoryRows({
        products: [product],
        shelves: [],
        sources: [
          supplier({
            sourceRefID: "supplier-a",
            supplierName: "甲供应商",
            onHandQty: "130件",
          }),
        ],
      }),
    ).toThrow("inventory row contract mismatch")
  })
})
