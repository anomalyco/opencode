import type { InventoryAnswerItem } from "./inventory-answer"

export type ProductRow = {
  productID: string
  name: string | null
  spec: string | null
  attribute: string | null
  remark: string | null
  totalInventory: string
}

export type ShelfRow = {
  productID: string
  shelfCode: string
}

export type InventorySourceRow = {
  productID: string
  sourceRefKind: string
  sourceRefID: string
  onHandQty: string
  supplierID: string | null
  supplierLegacyID: string | null
  supplierName: string | null
  supplierRole: string | null
  supplierEnabled: number | null
  supplierDeleted: number | null
}

export function mapInventoryRows(input: {
  products: readonly ProductRow[]
  shelves: readonly ShelfRow[]
  sources: readonly InventorySourceRow[]
}) {
  input.products.forEach((row) => {
    requiredText(row.productID)
    requiredText(row.name)
    decimal(row.totalInventory)
  })
  input.shelves.forEach((row) => {
    requiredText(row.productID)
    requiredText(row.shelfCode)
  })
  input.sources.forEach((row) => {
    requiredText(row.productID)
    requiredText(row.sourceRefKind)
    requiredText(row.sourceRefID)
    decimal(row.onHandQty)
  })

  return [...input.products]
    .sort((left, right) => left.productID.localeCompare(right.productID, undefined, { numeric: true }))
    .flatMap((product): InventoryAnswerItem[] => {
      const name = requiredText(product.name)
      const inventory = decimal(product.totalInventory)
      const shelves = [
        ...new Set(
          input.shelves
            .filter((row) => row.productID === product.productID)
            .map((row) => requiredText(row.shelfCode)),
        ),
      ]
      const size = product.spec
        ?.match(/\d+(?:\.\d+)?(?:\s*[*xX×]\s*\d+(?:\.\d+)?){1,}/)?.[0]
        .replace(/\s*[*xX×]\s*/g, "×")
      const attribute =
        product.attribute &&
        !/^[A-Za-z]+-\d+(?:-\d+)?(?:[、,，\s]+[A-Za-z]+-\d+(?:-\d+)?)*$/.test(product.attribute.trim())
          ? product.attribute.trim()
          : undefined
      const remark = optionalText(product.remark)
      const base = {
        name,
        shelves,
        ...(attribute ? { attribute } : {}),
        ...(size ? { size } : {}),
        ...(remark ? { remark } : {}),
      }
      const attributed = input.sources
        .filter(
          (row) =>
            row.productID === product.productID &&
            row.sourceRefKind !== "UNATTRIBUTED" &&
            !decimal(row.onHandQty).startsWith("-") &&
            row.supplierRole === "SUPPLIER" &&
            row.supplierEnabled === 1 &&
            row.supplierDeleted === 0 &&
            optionalText(row.supplierName),
        )
        .sort((left, right) => {
          const byName = requiredText(left.supplierName).localeCompare(requiredText(right.supplierName), "zh-CN")
          if (byName !== 0) return byName
          return left.sourceRefID.localeCompare(right.sourceRefID)
        })

      if (attributed.length === 0) return [{ ...base, inventory }]

      return attributed.map((row) => ({
        ...base,
        supplier: requiredText(row.supplierName),
        inventory: decimal(row.onHandQty),
      }))
    })
}

function requiredText(value: string | null) {
  const result = optionalText(value)
  if (!result) throw new Error("inventory row contract mismatch")
  return result
}

function optionalText(value: string | null) {
  const result = value?.trim()
  return result ? result : undefined
}

function decimal(value: string) {
  const normalized = value.trim()
  if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) {
    throw new Error("inventory row contract mismatch")
  }
  const [integer, fraction] = normalized.split(".")
  const trimmed = fraction?.replace(/0+$/, "")
  if (!trimmed) return integer === "-0" ? "0" : integer
  return `${integer}.${trimmed}`
}
