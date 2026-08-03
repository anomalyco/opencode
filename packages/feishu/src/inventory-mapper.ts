import type { InventoryAnswerItem } from "./inventory-answer"

export type ProductRow = {
  productID: string
  name: string | null
  spec: string | null
  attribute: string | null
  remark: string | null
  supplier: string | null
  totalInventory: string
}

export type ShelfRow = {
  productID: string
  shelfCode: string
}

export function mapInventoryRows(input: {
  products: readonly ProductRow[]
  shelves: readonly ShelfRow[]
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

  return input.products.map((product): InventoryAnswerItem => {
    const size = product.spec
      ?.match(/\d+(?:\.\d+)?(?:\s*[*xX×]\s*\d+(?:\.\d+)?){1,}/)?.[0]
      .replace(/\s*[*xX×]\s*/g, "×")
    const attribute = optionalText(product.attribute)
    const supplier = optionalText(product.supplier)
    const remark = optionalText(product.remark)
    return {
      name: requiredText(product.name),
      shelves: [
        ...new Set(
          input.shelves
            .filter((row) => row.productID === product.productID)
            .map((row) => requiredText(row.shelfCode)),
        ),
      ],
      ...(attribute && !shelfOnly(attribute) ? { attribute } : {}),
      ...(size ? { size } : {}),
      ...(supplier ? { supplier } : {}),
      inventory: decimal(product.totalInventory),
      ...(remark ? { remark } : {}),
    }
  })
}

function shelfOnly(value: string) {
  return /^[A-D]-\d{1,2}-\d{1,2}(?:[+，、,\s]+[A-D]-\d{1,2}-\d{1,2})*$/i.test(value)
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
