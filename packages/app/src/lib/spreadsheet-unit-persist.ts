const marker = "veritly.sheetUnit.v1:"

function slot(scope: string, fp: string) {
  return `${marker}${scope}\n${fp}`
}

export type SheetUnitSlot = { id: string; kind: "sheet" | "doc" | "slide" }

export function pullSlot(scope: string, fp: string): SheetUnitSlot | undefined {
  if (typeof localStorage === "undefined") return
  const raw = localStorage.getItem(slot(scope, fp))
  if (!raw) return
  let v: unknown
  try {
    v = JSON.parse(raw) as unknown
  } catch {
    return
  }
  if (!v || typeof v !== "object") return
  const id = Reflect.get(v, "id")
  const kind = Reflect.get(v, "kind")
  if (typeof id !== "string" || id.length === 0) return
  if (id.startsWith("pending-")) return
  if (kind !== "sheet" && kind !== "doc" && kind !== "slide") return
  return { id, kind }
}

export function pushSlot(scope: string, fp: string, id: string, kind: SheetUnitSlot["kind"]) {
  if (typeof localStorage === "undefined") return
  if (id.startsWith("pending-")) return
  localStorage.setItem(slot(scope, fp), JSON.stringify({ id, kind }))
}
