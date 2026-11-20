import { expect, test } from "bun:test"
import { builtins, NAME, type Node, program, validateData, WidgetSession } from "../src/index.js"

const template = (name: string) => {
  const found = builtins.find((item) => item.name === name)
  if (!found) throw new Error(`no builtin ${name}`)
  return found
}

const start = async (name: string, data: unknown) => {
  expect(validateData(template(name).data, data)).toEqual([])
  return WidgetSession.start(program(template(name).source), data)
}

// Every node in the view, depth first, for asserting on parts of a built-in's view.
const nodes = (node: Node): Node[] => [node, ...("children" in node ? node.children.flatMap(nodes) : [])]
const find = (view: Node, predicate: (node: Node) => boolean) => nodes(view).filter(predicate)

const press = (id: string) => ({ id, type: "press" as const })
const change = (id: string, value: unknown) => ({ id, type: "change" as const, value })

test("built-ins are suggestions, form and confirm with valid names", () => {
  expect(builtins.map((item) => item.name)).toEqual(["suggestions", "form", "confirm"])
  expect(builtins.every((item) => item.builtin && NAME.test(item.name) && item.description.length > 0)).toBe(true)
})

test("suggestions: pick a card, add a note, choose", async () => {
  const session = await start("suggestions", {
    title: "Pick a palette",
    options: [
      { label: "Warm", note: "Oranges and reds", images: ["warm-1.png", "warm-2.png"], recommended: true },
      { label: "Cool", images: ["https://example.com/cool.png"] },
    ],
  })
  const cards = find(session.view, (node) => node.type === "card")
  expect(cards.map((node) => node.type === "card" && node.id)).toEqual(["option:0", "option:1"])
  expect(find(cards[0], (node) => node.type === "carousel")).toHaveLength(1)
  expect(find(cards[0], (node) => node.type === "image")).toHaveLength(2)
  expect(find(cards[1], (node) => node.type === "carousel")).toHaveLength(0)
  expect(find(session.view, (node) => node.type === "text" && node.text === "(Recommended)")).toHaveLength(1)
  expect(
    find(session.view, (node) => node.type === "button" && node.id === "choose" && node.disabled === true),
  ).toHaveLength(1)

  // Choosing before picking does nothing.
  expect((await session.dispatch(press("choose"))).submit).toBeUndefined()
  await session.dispatch(press("option:1"))
  expect(
    find(session.view, (node) => node.type === "card" && node.selected === true).map(
      (node) => node.type === "card" && node.id,
    ),
  ).toEqual(["option:1"])
  await session.dispatch(change("note", "  but bluer  "))
  expect((await session.dispatch(press("choose"))).submit).toEqual({ choice: "Cool", index: 1, note: "but bluer" })
})

test("suggestions: no note input when allowNote is false, and dismiss", async () => {
  const session = await start("suggestions", {
    title: "Pick",
    allowNote: false,
    options: [
      { label: "A", images: ["a.png"] },
      { label: "B", images: ["b.png"] },
    ],
  })
  expect(find(session.view, (node) => node.type === "input")).toHaveLength(0)
  await session.dispatch(press("option:0"))
  expect((await session.dispatch(press("choose"))).submit).toEqual({ choice: "A", index: 0 })
  expect((await session.dispatch(press("dismiss"))).dismiss).toBe(true)
})

test("suggestions data schema enforces 2..3 options with 1..3 images", () => {
  const data = template("suggestions").data
  expect(validateData(data, { title: "x", options: [{ label: "a", images: ["a"] }] })).toEqual([
    "/options: must have at least 2 items",
  ])
  expect(
    validateData(data, {
      title: "x",
      options: [
        { label: "a", images: [] },
        { label: "b", images: ["b"] },
      ],
    }),
  ).toEqual(["/options/0/images: must have at least 1 items"])
})

test("form: one control per field type, edit, submit", async () => {
  const session = await start("form", {
    title: "New project",
    description: "Set up **everything**",
    submitLabel: "Create",
    fields: [
      { key: "name", type: "text", label: "Name", placeholder: "my-app" },
      { key: "size", type: "number", label: "Size", min: 1, max: 10, step: 1, default: 3 },
      { key: "private", type: "boolean", label: "Private" },
      {
        key: "stack",
        type: "select",
        label: "Stack",
        options: [
          { value: "bun", label: "Bun" },
          { value: "node", label: "Node" },
        ],
      },
      {
        key: "tags",
        type: "select",
        label: "Tags",
        multiple: true,
        options: [
          { value: "web", label: "Web" },
          { value: "cli", label: "CLI" },
        ],
      },
    ],
  })
  expect(nodes(session.view).map((node) => node.type)).toEqual([
    "column",
    "text",
    "markdown",
    "column",
    "input",
    "slider",
    "checkbox",
    "select",
    "select",
    "row",
    "button",
  ])
  expect(find(session.view, (node) => node.type === "slider")).toEqual([
    { type: "slider", id: "field:size", label: "Size", value: 3, min: 1, max: 10, step: 1 },
  ])
  expect(find(session.view, (node) => node.type === "button")).toEqual([
    { type: "button", id: "submit", label: "Create", variant: "primary" },
  ])

  await session.dispatch(change("field:name", "atlas"))
  await session.dispatch(change("field:size", 42))
  await session.dispatch(change("field:private", true))
  await session.dispatch(change("field:stack", "node"))
  await session.dispatch(change("field:tags", ["web", "cli"]))
  expect(find(session.view, (node) => node.type === "checkbox")).toEqual([
    { type: "checkbox", id: "field:private", label: "Private", checked: true },
  ])
  expect((await session.dispatch(press("submit"))).submit).toEqual({
    name: "atlas",
    size: 10,
    private: true,
    stack: "node",
    tags: ["web", "cli"],
  })
})

test("form submits defaults untouched", async () => {
  const session = await start("form", {
    title: "Defaults",
    fields: [
      { key: "note", type: "text", label: "Note", multiline: true, default: "hi" },
      { key: "level", type: "number", label: "Level", min: 2, max: 5 },
      { key: "on", type: "boolean", label: "On", default: true },
    ],
  })
  expect((await session.dispatch(press("submit"))).submit).toEqual({ note: "hi", level: 2, on: true })
})

test("form data schema checks each field type", () => {
  expect(
    validateData(template("form").data, {
      title: "x",
      fields: [{ key: "n", type: "number", label: "N", min: 0 }],
    }),
  ).toEqual(["/fields/0/max: is required"])
})

test("confirm: confirm and cancel", async () => {
  const session = await start("confirm", {
    title: "Delete branch?",
    message: "This removes `widgets` for good.",
    confirmLabel: "Delete",
    danger: true,
  })
  expect(find(session.view, (node) => node.type === "button")).toEqual([
    { type: "button", id: "confirm", label: "Delete", variant: "danger" },
    { type: "button", id: "cancel", label: "Cancel", variant: "secondary" },
  ])
  expect((await session.dispatch(press("cancel"))).submit).toEqual({ confirmed: false })
  expect((await session.dispatch(press("confirm"))).submit).toEqual({ confirmed: true })
})
