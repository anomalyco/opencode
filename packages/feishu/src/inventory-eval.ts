import type { InventoryAnswerItem } from "./inventory-answer"

export type InventoryGoldOutcome = {
  intent: {
    kind: string
    term: string
  }
  templateVersion: string | null
  parameters: {
    term: string
    limit: number
  } | null
  result: InventoryAnswerItem[]
  answer: string
  policy: "allow" | "block"
}

export type InventoryGoldExpectedCase = {
  id: string
  category: "read" | "policy"
  expected: InventoryGoldOutcome
}

export type InventoryGoldCase = InventoryGoldExpectedCase & {
  observed: InventoryGoldOutcome
}

export function evaluateInventoryCases(cases: readonly InventoryGoldCase[]) {
  const reads = cases.filter((item) => item.category === "read")
  const intent = ratio(
    reads,
    (item) =>
      item.observed.intent.kind === item.expected.intent.kind &&
      item.observed.intent.term === item.expected.intent.term,
  )
  const sql = ratio(
    reads,
    (item) =>
      item.observed.templateVersion === item.expected.templateVersion &&
      equal(item.observed.parameters, item.expected.parameters),
  )
  const result = ratio(reads, (item) => equalResult(item.observed.result, item.expected.result))
  const answer = ratio(reads, (item) => item.observed.answer === item.expected.answer)
  const policy = ratio(cases, (item) => item.observed.policy === item.expected.policy)

  return {
    intent,
    sql,
    result,
    answer,
    policy,
    passed: intent >= 0.95 && sql >= 0.95 && result >= 0.95 && answer >= 0.95 && policy === 1,
  }
}

function ratio<T>(items: readonly T[], matches: (item: T) => boolean) {
  if (items.length === 0) return 0
  return items.filter(matches).length / items.length
}

function equal(
  left: InventoryGoldOutcome["parameters"],
  right: InventoryGoldOutcome["parameters"],
) {
  if (left === null || right === null) return left === right
  return left.term === right.term && left.limit === right.limit
}

function equalResult(left: readonly InventoryAnswerItem[], right: readonly InventoryAnswerItem[]) {
  return JSON.stringify(left.map(normalizeItem)) === JSON.stringify(right.map(normalizeItem))
}

function normalizeItem(item: InventoryAnswerItem) {
  return {
    name: item.name,
    ...(item.attribute === undefined ? {} : { attribute: item.attribute }),
    ...(item.size === undefined ? {} : { size: item.size }),
    shelves: [...item.shelves],
    ...(item.supplier === undefined ? {} : { supplier: item.supplier }),
    ...(item.inventory === undefined ? {} : { inventory: item.inventory }),
    ...(item.remark === undefined ? {} : { remark: item.remark }),
  }
}
