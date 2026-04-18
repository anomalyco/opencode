// @ts-nocheck
import * as mod from "./list"
import { create } from "../storybook/scaffold"

const docs = `### Overview
Filterable list with keyboard navigation and optional search input.

Use within panels or popovers where keyboard navigation is expected.

### API
- Required: \`items\` and \`key\`.
- Required: \`children\` render function for items.
- Optional: \`search\`, \`filterKeys\`, \`groupBy\`, \`onSelect\`, \`onKeyEvent\`.

### Variants and states
- Optional search bar and group headers.

### Behavior
- Uses fuzzy search when \`search\` is enabled.
- Keyboard navigation via arrow keys; Enter selects.

### Accessibility
- TODO: confirm ARIA roles for list items and search input.

### Theming/tokens
- Uses \`data-component="list"\` and data slots for structure.

`

const story = create({
  title: "UI/List",
  mod,
  args: {
    items: ["One", "Two", "Three", "Four"],
    key: (x: string) => x,
    children: (x: string) => x,
    search: true,
  },
})

export default {
  title: "UI/List",
  id: "components-list",
  component: story.meta.component,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component: docs,
      },
    },
  },
}

export const Basic = story.Basic

export const Grouped = {
  render: () => {
    const items = [
      { id: "a1", title: "Alpha", group: "Group A" },
      { id: "a2", title: "Bravo", group: "Group A" },
      { id: "b1", title: "Delta", group: "Group B" },
    ]
    return (
      <mod.List items={items} key={(item) => item.id} groupBy={(item) => item.group} search={true}>
        {(item) => item.title}
      </mod.List>
    )
  },
}

export const Empty = {
  render: () => (
    <mod.List items={[]} key={(item) => item} search={true}>
      {(item) => item}
    </mod.List>
  ),
}

export const WithAdd = {
  render: () => (
    <mod.List
      items={["One", "Two"]}
      key={(item) => item}
      search={true}
      add={{
        render: () => (
          <button type="button" data-slot="list-item">
            Add item
          </button>
        ),
      }}
    >
      {(item) => item}
    </mod.List>
  ),
}

export const Divider = {
  render: () => (
    <mod.List items={["One", "Two", "Three"]} key={(item) => item} divider={true}>
      {(item) => item}
    </mod.List>
  ),
}

export const ActiveIcon = {
  render: () => (
    <mod.List items={["Alpha", "Beta", "Gamma"]} key={(item) => item} activeIcon="chevron-right">
      {(item) => item}
    </mod.List>
  ),
}

export const NoSearch = {
  render: () => (
    <mod.List items={["One", "Two", "Three"]} key={(item) => item} search={false}>
      {(item) => item}
    </mod.List>
  ),
}

export const SearchOptions = {
  render: () => (
    <mod.List
      items={["Apple", "Banana", "Cherry"]}
      key={(item) => item}
      search={{
        placeholder: "Filter...",
        hideIcon: true,
        action: <button type="button">Action</button>,
      }}
    >
      {(item) => item}
    </mod.List>
  ),
}

export const ItemWrapper = {
  render: () => (
    <mod.List
      items={["One", "Two", "Three"]}
      key={(item) => item}
      itemWrapper={(item, node) => (
        <div style={{ border: "1px solid var(--border-weak)", "border-radius": "6px", margin: "4px 0" }}>{node}</div>
      )}
    >
      {(item) => item}
    </mod.List>
  ),
}

export const GroupHeader = {
  render: () => {
    const items = [
      { id: "a1", title: "Alpha", group: "Group A" },
      { id: "b1", title: "Beta", group: "Group B" },
    ]
    return (
      <mod.List
        items={items}
        key={(item) => item.id}
        groupBy={(item) => item.group}
        groupHeader={(group) => <strong>{group.category}</strong>}
      >
        {(item) => item.title}
      </mod.List>
    )
  },
}
