import { expect, test } from "bun:test"
import { iconsInSource } from "../../../script/generate-icon-usage"

test("collects catalog artwork from direct and indirect icon values", () => {
  const source = `
    const pageIcons = { shortcuts: "keyboard" }
    function workspaceIcon() { return "workspace" }

    const buttons = [
      { icon: "outline-globe" },
      { get icon() { return "terminal" } },
    ]

    const component = () => (
      <>
        <Icon name={mode === "link" ? "outline-copy" : fallback ?? "plus"} />
        <ui.Icon name="outline-chevron-down" />
        <TextInput clearIcon="close" />
        <Glyph fallback="outline-globe" />
        <Button icon="folder" />
      </>
    )
  `

  expect(iconsInSource("component.tsx", source)).toEqual([
    "chevron-down",
    "close",
    "copy",
    "folder",
    "globe",
    "keyboard",
    "plus",
    "terminal",
    "workspace",
  ])
})

test("ignores unrelated strings and other icon catalogs", () => {
  const source = `
    // <Icon name="check" />
    const labels = { confirm: "check" }
    const openApp = { icon: "terminal", openWith: "Terminal" }
    const icon = () => props.icon ?? "comment"
    const kind: "copy" = "copy"
    const component = () => (
      <>
        <AppIcon name="terminal" />
        <FileIcon name="folder" />
        <InlineGlyph icon={icon()} />
        <Icon name={name === "link" ? other : label("search")} />
      </>
    )
  `

  expect(iconsInSource("component.tsx", source)).toEqual([])
})
