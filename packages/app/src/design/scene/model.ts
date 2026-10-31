import { uuid } from "@opencode/util/uuid"

export type DesignShape = "box" | "sphere" | "cylinder" | "cone" | "torus" | "knot" | "capsule" | "plane"

export type Vec3 = [number, number, number]

export type DesignMaterial = {
  color: string
  metalness: number
  roughness: number
  emissive: string
  emissiveIntensity: number
  opacity: number
  wireframe: boolean
}

export type DesignObject = {
  id: string
  name: string
  shape: DesignShape
  position: Vec3
  rotation: Vec3
  scale: Vec3
  material: DesignMaterial
  visible: boolean
}

export type DesignScene = {
  version: 1
  name: string
  objects: DesignObject[]
}

export type DesignNoticeKey =
  | "design.notice.added"
  | "design.notice.updated"
  | "design.notice.deleted"
  | "design.notice.cleared"
  | "design.notice.selected"
  | "design.notice.duplicated"
  | "design.notice.renamed"
  | "design.notice.unknown"
  | "design.notice.noSelection"
  | "design.notice.notFound"
  | "design.notice.emptyPrompt"
  | "design.notice.aiUpdated"
  | "design.notice.aiFailed"

export type PromptOutcome = {
  scene: DesignScene
  selection: string | undefined
  ok: boolean
  notice: { key: DesignNoticeKey; params?: Record<string, string | number> }
}

export const DESIGN_SHAPES: DesignShape[] = ["box", "sphere", "cylinder", "cone", "torus", "knot", "capsule", "plane"]

export const DESIGN_COLORS = ["#5b8def", "#43b581", "#e2b13c", "#e8833a", "#d65780", "#a97cf8", "#35b8c9", "#8b8b8b"]

const palette = DESIGN_COLORS

const shapeLabels: Record<DesignShape, string> = {
  box: "Cube",
  sphere: "Sphere",
  cylinder: "Cylinder",
  cone: "Cone",
  torus: "Torus",
  knot: "Torus Knot",
  capsule: "Capsule",
  plane: "Plane",
}

const shapeWords: Record<string, DesignShape> = {
  cube: "box",
  box: "box",
  block: "box",
  würfel: "box",
  wuerfel: "box",
  quader: "box",
  sphere: "sphere",
  ball: "sphere",
  kugel: "sphere",
  cylinder: "cylinder",
  zylinder: "cylinder",
  cone: "cone",
  kegel: "cone",
  torus: "torus",
  donut: "torus",
  ring: "torus",
  reifen: "torus",
  knot: "knot",
  torusknot: "knot",
  "torus knot": "knot",
  "torus-knot": "knot",
  knoten: "knot",
  capsule: "capsule",
  pill: "capsule",
  kapsel: "capsule",
  plane: "plane",
  floor: "plane",
  ground: "plane",
  ebene: "plane",
  fläche: "plane",
  flaeche: "plane",
  boden: "plane",
}

const colorWords: Record<string, string> = {
  red: "#d94545",
  rot: "#d94545",
  orange: "#e8833a",
  yellow: "#e2b13c",
  gelb: "#e2b13c",
  green: "#43b581",
  grün: "#43b581",
  gruen: "#43b581",
  cyan: "#35b8c9",
  türkis: "#35b8c9",
  tuerkis: "#35b8c9",
  blue: "#5b8def",
  blau: "#5b8def",
  purple: "#a97cf8",
  lila: "#a97cf8",
  violett: "#a97cf8",
  pink: "#d65780",
  rosa: "#d65780",
  magenta: "#c94fb0",
  brown: "#8a6246",
  braun: "#8a6246",
  black: "#141414",
  schwarz: "#141414",
  white: "#f5f5f5",
  weiß: "#f5f5f5",
  weiss: "#f5f5f5",
  grey: "#8b8b8b",
  gray: "#8b8b8b",
  grau: "#8b8b8b",
  gold: "#d7a93c",
  silber: "#b9c0c8",
  silver: "#b9c0c8",
  teal: "#2f8f83",
}

const addVerbs = /\b(add|create|place|spawn|drop|generate|erzeuge|erstelle|erstellen|füge|fuege|hinzufügen|hinzufuegen|platziere|baue|bau)\b/i

const deleteVerbs = /\b(delete|remove|lösche|loesche|entferne|entfernen)\b/i

const clearVerbs = /\b(clear|reset|empty|leeren|alles löschen|alles loeschen)\b/i

const duplicateVerbs = /\b(duplicate|copy|clone|dupliziere|kopiere|klone)\b/i

const renameVerbs = /\b(rename|benenne|umbenennen)\b/i

const selectVerbs = /\b(select|choose|wähle|waehle|auswählen|auswaehlen)\b/i

const moveVerbs = /\b(move|shift|verschiebe|bewege|setze)\b/i

const rotateVerbs = /\b(rotate|turn|spin|drehe|rotiere)\b/i

const scaleVerbs = /\b(scale|resize|skaliere|vergrößere|vergroessere|verkleinere)\b/i

const colorVerbs = /\b(color|colour|paint|tint|färbe|faerbe|farbe)\b/i

export function createScene(): DesignScene {
  return { version: 1, name: "Untitled scene", objects: [] }
}

export function parseDesignScene(input: unknown): DesignScene | undefined {
  if (!isRecord(input) || (input.version !== undefined && input.version !== 1) || !Array.isArray(input.objects))
    return
  const name = typeof input.name === "string" && input.name.trim() ? input.name : "Scene"
  const seen = new Set<string>()

  const objects = input.objects.flatMap((item) => {
    if (!isRecord(item)) return []
    const shape = readShape(item.shape)

    if (!shape) return []
    const fallback = defaultMaterial(shape)
    const mat = isRecord(item.material) ? item.material : {}

    const material: DesignMaterial = {
      color: readColor(mat.color) ?? fallback.color,
      metalness: readNumber(mat.metalness, fallback.metalness),
      roughness: readNumber(mat.roughness, fallback.roughness),
      emissive: readColor(mat.emissive) ?? fallback.emissive,
      emissiveIntensity: readNumber(mat.emissiveIntensity, fallback.emissiveIntensity),
      opacity: Math.min(1, Math.max(0, readNumber(mat.opacity, fallback.opacity))),
      wireframe: typeof mat.wireframe === "boolean" ? mat.wireframe : fallback.wireframe,
    }

    const id = uniqueID(seen, typeof item.id === "string" ? item.id : undefined)

    return [
      {
        id,
        name: typeof item.name === "string" && item.name.trim() ? item.name : id,
        shape,
        position: readVector(item.position, defaultPosition(shape)),
        rotation: readVector(item.rotation, defaultRotation(shape)),
        scale: readVector(item.scale, [1, 1, 1]),
        material,
        visible: typeof item.visible === "boolean" ? item.visible : true,
      },
    ]
  })

  return { version: 1, name, objects }
}

function uniqueID(seen: Set<string>, value: string | undefined) {
  const candidate = value && !seen.has(value) ? value : uuid()

  seen.add(candidate)

  return candidate
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function readShape(value: unknown): DesignShape | undefined {
  if (typeof value !== "string") return
  const normalized = value.toLowerCase().trim()

  return DESIGN_SHAPES.find((shape) => shape === normalized)
}

function readColor(value: unknown) {
  if (typeof value !== "string") return
  const hex = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)?.[1]

  if (!hex) return

  return hex.length === 3 ? `#${hex.split("").map((part) => part + part).join("")}`.toLowerCase() : `#${hex}`.toLowerCase()
}

function readNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

function readVector(value: unknown, fallback: Vec3): Vec3 {
  if (!Array.isArray(value) || value.length < 3) return fallback

  return [readNumber(value[0], fallback[0]), readNumber(value[1], fallback[1]), readNumber(value[2], fallback[2])]
}

export function createDesignObject(shape: DesignShape, position?: Vec3): DesignObject {
  return {
    id: uuid(),
    name: shapeLabels[shape],
    shape,
    position: position ?? defaultPosition(shape),
    rotation: defaultRotation(shape),
    scale: [1, 1, 1],
    material: defaultMaterial(shape),
    visible: true,
  }
}

export function defaultMaterial(shape: DesignShape): DesignMaterial {
  const color = shape === "plane" ? "#7a8794" : palette[0]!

  return {
    color,
    metalness: 0,
    roughness: shape === "plane" ? 0.8 : 0.42,
    emissive: "#000000",
    emissiveIntensity: 1,
    opacity: 1,
    wireframe: false,
  }
}

export function nextObjectName(scene: DesignScene, base: string) {
  if (!scene.objects.some((object) => object.name === base)) return base
  const used = new Set(scene.objects.map((object) => object.name))

  for (let index = 2; ; index++) {
    const candidate = `${base} ${index}`

    if (!used.has(candidate)) return candidate
  }
}

export function addObject(scene: DesignScene, shape: DesignShape, position?: Vec3): { scene: DesignScene; object: DesignObject } {
  const object = createDesignObject(shape, position)
  object.name = nextObjectName(scene, shapeLabels[shape])
  object.material.color = palette[scene.objects.length % palette.length]!

  return { scene: { ...scene, objects: [...scene.objects, object] }, object }
}

export function updateObject(scene: DesignScene, id: string, update: Partial<Omit<DesignObject, "id">>): DesignScene {
  return {
    ...scene,
    objects: scene.objects.map((object) => (object.id === id ? { ...object, ...update } : object)),
  }
}

export function updateMaterial(scene: DesignScene, id: string, update: Partial<DesignMaterial>): DesignScene {
  return {
    ...scene,
    objects: scene.objects.map((object) =>
      object.id === id ? { ...object, material: { ...object.material, ...update } } : object,
    ),
  }
}

export function removeObject(scene: DesignScene, id: string): DesignScene {
  return { ...scene, objects: scene.objects.filter((object) => object.id !== id) }
}

export function duplicateObject(scene: DesignScene, id: string): { scene: DesignScene; object: DesignObject | undefined } {
  const source = scene.objects.find((object) => object.id === id)

  if (!source) return { scene, object: undefined }

  const object: DesignObject = {
    ...source,
    id: uuid(),
    name: nextObjectName(scene, source.name.replace(/\s+\d+$/, "")),
    position: [source.position[0] + 0.75, source.position[1], source.position[2] + 0.75],
    material: { ...source.material },
  }

  return { scene: { ...scene, objects: [...scene.objects, object] }, object }
}

export function interpretPrompt(scene: DesignScene, prompt: string, selectedId?: string): PromptOutcome {
  const text = prompt.trim()
  const lower = text.toLowerCase()

  if (!text) return fail(scene, selectedId, "design.notice.emptyPrompt")

  if (clearVerbs.test(lower)) {
    return {
      scene: { ...scene, objects: [] },
      selection: undefined,
      ok: true,
      notice: { key: "design.notice.cleared" },
    }
  }

  const target = resolveTarget(scene, lower, selectedId)

  if (deleteVerbs.test(lower)) {
    if (!target) return fail(scene, selectedId, "design.notice.noSelection")

    return {
      scene: removeObject(scene, target.id),
      selection: selectedId === target.id ? undefined : selectedId,
      ok: true,
      notice: { key: "design.notice.deleted", params: { name: target.name } },
    }
  }

  if (duplicateVerbs.test(lower)) {
    if (!target) return fail(scene, selectedId, "design.notice.noSelection")
    const result = duplicateObject(scene, target.id)

    return {
      scene: result.scene,
      selection: result.object?.id ?? selectedId,
      ok: true,
      notice: { key: "design.notice.duplicated", params: { name: target.name } },
    }
  }

  if (selectVerbs.test(lower)) {
    if (!target) return fail(scene, selectedId, "design.notice.notFound")

    return {
      scene,
      selection: target.id,
      ok: true,
      notice: { key: "design.notice.selected", params: { name: target.name } },
    }
  }

  if (renameVerbs.test(lower)) {
    if (!target) return fail(scene, selectedId, "design.notice.noSelection")
    const name = parseRename(text)

    if (!name) return fail(scene, selectedId, "design.notice.notFound")

    return {
      scene: updateObject(scene, target.id, { name }),
      selection: selectedId,
      ok: true,
      notice: { key: "design.notice.renamed", params: { name } },
    }
  }

  const shape = findShape(lower)

  if (shape && addVerbs.test(lower)) return addFromPrompt(scene, lower, shape)

  if (target && (moveVerbs.test(lower) || rotateVerbs.test(lower) || scaleVerbs.test(lower))) {
    return transformFromPrompt(scene, lower, target, selectedId)
  }

  if (target) {
    const material = parseMaterial(lower, target.material)

    if (material) {
      return {
        scene: updateMaterial(scene, target.id, material),
        selection: selectedId,
        ok: true,
        notice: { key: "design.notice.updated", params: { name: target.name } },
      }
    }
  }

  if (shape) return addFromPrompt(scene, lower, shape)

  const color = parseColor(lower)

  if (color && selectedId) {
    const selected = scene.objects.find((object) => object.id === selectedId)

    if (selected) {
      return {
        scene: updateMaterial(scene, selected.id, { color }),
        selection: selectedId,
        ok: true,
        notice: { key: "design.notice.updated", params: { name: selected.name } },
      }
    }
  }

  if (colorVerbs.test(lower)) return fail(scene, selectedId, "design.notice.noSelection")

  return fail(scene, selectedId, "design.notice.unknown")
}

function fail(scene: DesignScene, selection: string | undefined, key: DesignNoticeKey): PromptOutcome {
  return { scene, selection, ok: false, notice: { key } }
}

function addFromPrompt(scene: DesignScene, text: string, shape: DesignShape): PromptOutcome {
  const position = vectorAfter(text, ["at", "position", "pos", "bei", "zu", "auf"]) ?? defaultPosition(shape)
  const result = addObject(scene, shape, position)
  const object = result.object
  const color = parseColor(text)
  const material = parseMaterial(text, object.material) ?? {}
  const scale = parseScale(text)
  const rotation = parseRotation(text)
  const name = parseName(text)

  if (color) material.color = color

  if (scale) object.scale = scale

  if (rotation) object.rotation = rotation

  if (name) object.name = nextObjectName(result.scene, name)
  object.material = { ...object.material, ...material }

  return {
    scene: { ...result.scene, objects: result.scene.objects.map((item) => (item.id === object.id ? object : item)) },
    selection: object.id,
    ok: true,
    notice: { key: "design.notice.added", params: { name: object.name } },
  }
}

function transformFromPrompt(
  scene: DesignScene,
  text: string,
  target: DesignObject,
  selectedId?: string,
): PromptOutcome {
  if (moveVerbs.test(text)) {
    const by = vectorAfter(text, ["by", "um"])
    const to = vectorAfter(text, ["to", "nach", "auf"])

    const position: Vec3 | undefined = by
      ? [target.position[0] + by[0], target.position[1] + by[1], target.position[2] + by[2]]
      : to

    if (!position) return fail(scene, selectedId, "design.notice.unknown")

    return updated(scene, target, selectedId, { position })
  }

  if (rotateVerbs.test(text)) {
    const raw = vectorAfter(text, ["by", "um"]) ?? vectorAfter(text, ["to", "auf"]) ?? numbers(text).slice(0, 3)
    const by = /\b(by|um)\b/i.test(text)

    if (raw.length < 3) return fail(scene, selectedId, "design.notice.unknown")

    const rotation: Vec3 = by
      ? [target.rotation[0] + degrees(raw[0]), target.rotation[1] + degrees(raw[1]), target.rotation[2] + degrees(raw[2])]
      : [degrees(raw[0]), degrees(raw[1]), degrees(raw[2])]

    return updated(scene, target, selectedId, { rotation })
  }

  const by = vectorAfter(text, ["by", "um"]) ?? uniformAfter(text, ["by", "um"])
  const to = vectorAfter(text, ["to", "auf"]) ?? dimension(text) ?? numbers(text).slice(0, 3)

  if (!by && to.length < 3) return fail(scene, selectedId, "design.notice.unknown")

  const scale: Vec3 = by
    ? [target.scale[0] * (by[0] || 1), target.scale[1] * (by[1] || 1), target.scale[2] * (by[2] || 1)]
    : [to[0], to[1], to[2]]

  return updated(scene, target, selectedId, { scale })
}

function updated(
  scene: DesignScene,
  target: DesignObject,
  selectedId: string | undefined,
  update: Partial<Omit<DesignObject, "id">>,
): PromptOutcome {
  return {
    scene: updateObject(scene, target.id, update),
    selection: selectedId,
    ok: true,
    notice: { key: "design.notice.updated", params: { name: target.name } },
  }
}

function resolveTarget(scene: DesignScene, text: string, selectedId?: string) {
  if (/\b(selected|selection|selected object|it|es|das objekt|ausgewählt|ausgewaehlt)\b/.test(text)) {
    return scene.objects.find((object) => object.id === selectedId)
  }

  const named = scene.objects
    .filter((object) => text.includes(object.name.toLowerCase()))
    .toSorted((a, b) => b.name.length - a.name.length)[0]

  if (named) return named
  const selected = scene.objects.find((object) => object.id === selectedId)

  if (selected) return selected

  if (scene.objects.length === 1) return scene.objects[0]
}

function findShape(text: string): DesignShape | undefined {
  return Object.entries(shapeWords)
    .filter(([word]) => wordIn(text, word))
    .toSorted((a, b) => b[0].length - a[0].length)
    .map(([, shape]) => shape)[0]
}

function wordIn(text: string, word: string) {
  return new RegExp(`(^|[^a-zäöüß])${word}([^a-zäöüß]|$)`, "i").test(text)
}

function parseColor(text: string): string | undefined {
  const hex = text.match(/#([0-9a-f]{6}|[0-9a-f]{3})\b/i)?.[1]

  if (hex) return `#${hex.length === 3 ? hex.split("").map((value) => value + value).join("") : hex}`.toLowerCase()
  const rgb = text.match(/rgb\s*\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)/i)

  if (rgb) {
    const channels = rgb.slice(1, 4).map((value) => Math.min(255, Number(value)).toString(16).padStart(2, "0"))

    return `#${channels.join("")}`
  }

  return Object.entries(colorWords)
    .filter(([word]) => colorIn(text, word))
    .toSorted((a, b) => b[0].length - a[0].length)
    .map(([, color]) => color)[0]
}

function colorIn(text: string, word: string) {
  return new RegExp(`(^|[^a-zäöüß])${word}(e|er|es|en|em)?([^a-zäöüß]|$)`, "i").test(text)
}

function parseMaterial(text: string, current: DesignMaterial): Partial<DesignMaterial> | undefined {
  const update: Partial<DesignMaterial> = {}
  const color = parseColor(text)
  const metalness = numericValue(text, ["metalness", "metallness", "metallic", "metallisch"])
  const roughness = numericValue(text, ["roughness", "rauheit"])

  if (color) update.color = color

  if (metalness !== undefined) update.metalness = clamp01(metalness)

  if (roughness !== undefined) update.roughness = clamp01(roughness)

  if (/\b(chrome|chrom)\b/i.test(text)) Object.assign(update, { metalness: 1, roughness: 0.05 })
  else if (/\b(metal|metallic|metallisch)\b/i.test(text)) Object.assign(update, { metalness: 0.9, roughness: 0.25 })

  if (/\b(matte|matt|rough|rau)\b/i.test(text)) Object.assign(update, { roughness: 0.92, metalness: 0 })

  if (/\b(shiny|glänzend|glaenzend|glanz|polished|poliert)\b/i.test(text))
    Object.assign(update, { roughness: 0.08, metalness: Math.max(current.metalness, 0.5) })

  if (/\b(glass|glas|transparent|durchsichtig)\b/i.test(text))
    Object.assign(update, { opacity: 0.42, roughness: 0.05, metalness: 0 })

  if (/\b(glow|glowing|neon|leuchtet|leuchten|leuchtend)\b/i.test(text))
    Object.assign(update, {
      emissive: color ?? current.color,
      emissiveIntensity: 1.6,
      roughness: Math.min(current.roughness, 0.35),
    })

  if (/\b(wireframe|drahtgitter|draht)\b/i.test(text)) update.wireframe = true

  if (/\b(solid|undurchsichtig)\b/i.test(text)) {
    update.opacity = 1
    update.wireframe = false
  }

  if (Object.keys(update).length === 0) return

  return update
}

function parseScale(text: string): Vec3 | undefined {
  const after =
    vectorAfter(text, ["size", "größe", "groesse", "scale", "skaliere"]) ??
    uniformAfter(text, ["size", "größe", "groesse", "scale", "skaliere"])

  const dimensionScale = dimension(text)
  const value = after ?? dimensionScale

  if (value) return [value[0], value[1], value[2]]
}

function parseRotation(text: string): Vec3 | undefined {
  const after = vectorAfter(text, ["rotate", "rotation", "drehe", "rotiere", "gedreht"])

  if (!after || after.length < 3) return

  return [degrees(after[0]), degrees(after[1]), degrees(after[2])]
}

function parseName(text: string) {
  const match = text.match(/\b(?:named|called|name|heisst|heißt|namens)\s+([a-z0-9äöüß _-]+)/i)

  if (!match?.[1]) return

  const name = match[1]
    .replace(/\b(at|with|in|mit|und|and|color|colour|farbe)\b.*$/i, "")
    .replace(/[.,;!?]+$/, "")
    .trim()

  return name ? name.slice(0, 48) : undefined
}

function parseRename(text: string) {
  const match = text.match(/\b(?:to|zu|in|als)\s+["']?([a-z0-9äöüß _-]+)["']?/i)
  const name = match?.[1]?.replace(/[.,;!?]+$/, "").trim()

  return name ? name.slice(0, 48) : undefined
}

function numbers(text: string) {
  return [...text.matchAll(/-?\d+(?:[.,]\d+)?/g)].map((match) => Number(match[0].replace(",", ".")))
}

function vectorAfter(text: string, words: string[]): Vec3 | undefined {
  const match = text.match(
    new RegExp(
      `\\b(?:${words.join("|")})\\b\\s*\\(?\\s*(-?\\d+(?:[.,]\\d+)?)(?:\\s*[, ]\\s*(-?\\d+(?:[.,]\\d+)?))?(?:\\s*[, ]\\s*(-?\\d+(?:[.,]\\d+)?))?`,
      "i",
    ),
  )

  if (!match) return
  const values = match.slice(1, 4).filter((value): value is string => value !== undefined)
  const vector = values.map((value) => Number(value.replace(",", ".")))

  return vector.length >= 2 ? [vector[0]!, vector[1]!, vector[2] ?? vector[1]!] : undefined
}

function uniformAfter(text: string, words: string[]): Vec3 | undefined {
  const match = text.match(new RegExp(`\\b(?:${words.join("|")})\\b\\s*(-?\\d+(?:[.,]\\d+)?)`, "i"))

  if (!match?.[1]) return
  const value = Number(match[1].replace(",", "."))

  return [value, value, value]
}

function dimension(text: string): Vec3 | undefined {
  const match = text.match(
    /(\d+(?:[.,]\d+)?)\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*[x×]\s*(\d+(?:[.,]\d+)?)/i,
  )

  if (!match) return

  return [Number(match[1]!.replace(",", ".")), Number(match[2]!.replace(",", ".")), Number(match[3]!.replace(",", "."))]
}

function numericValue(text: string, words: string[]) {
  const match = text.match(
    new RegExp(`\\b(?:${words.join("|")})\\b\\s*(?:=|:|to|auf|bei)?\\s*(-?\\d*[.,]?\\d+)`, "i"),
  )

  return match?.[1] ? Number(match[1].replace(",", ".")) : undefined
}

function degrees(value: number) {
  return (value * Math.PI) / 180
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value))
}

function defaultPosition(shape: DesignShape): Vec3 {
  if (shape === "plane") return [0, 0, 0]

  if (shape === "box") return [0, 0.5, 0]

  if (shape === "sphere") return [0, 0.75, 0]

  if (shape === "capsule") return [0, 0.9, 0]

  if (shape === "knot") return [0, 0.76, 0]

  return [0, 0.6, 0]
}

function defaultRotation(shape: DesignShape): Vec3 {
  return shape === "plane" ? [-Math.PI / 2, 0, 0] : [0, 0, 0]
}
