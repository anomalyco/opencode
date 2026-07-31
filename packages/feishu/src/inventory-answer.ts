export type InventoryAnswerItem = {
  name: string
  attribute?: string
  size?: string
  shelves: string[]
  supplier?: string
  inventory?: string
  remark?: string
}

export function formatInventoryAnswer(items: readonly InventoryAnswerItem[]) {
  if (items.length === 0) return "未找到相关商品。"

  return items
    .map((item) => {
      const name = clean(item.name)
      const attribute = clean(item.attribute)
      const size = clean(item.size)?.replace(/[*xX]/g, "×")
      const shelves = [...new Set(item.shelves.map(clean).filter((value) => value !== undefined))]
      const supplier = clean(item.supplier)
      const inventory = clean(item.inventory)
      const remark = clean(item.remark)

      return [
        name,
        attribute ? `（${attribute}）` : "",
        size ? `（${size}）` : "",
        shelves.length > 0 ? `（货架号：${shelves.join("、")}）` : "",
        inventory ? `${supplier ?? ""}库存${inventory}` : "",
        remark ? `，备注：${remark}` : "",
      ].join("")
    })
    .join("\n")
}

function clean(value: string | undefined) {
  const result = value?.replace(/\r\n|\r|\n/g, " ").trim()
  return result ? result : undefined
}
