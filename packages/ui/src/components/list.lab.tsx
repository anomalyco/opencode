import { createSignal } from "solid-js"
import { List } from "./list"

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

type ListArgs = { search: boolean }

export default {
  title: "UI/List",
  id: "components-list",
  component: List,
  args: { search: true },
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component: docs,
      },
    },
  },
}

function NumberList(props: ListArgs & { current?: string; query?: string }) {
  const [selected, setSelected] = createSignal(props.current)

  const [filter, setFilter] = createSignal(props.query ?? "")

  return (
    <List
      items={["One", "Two", "Three", "Four"]}
      key={(item) => item}
      search={props.search}
      current={selected()}
      onSelect={setSelected}
      filter={filter()}
      onFilter={setFilter}
    >
      {(item) => item}
    </List>
  )
}

export const Basic = { render: NumberList }

export const Selected = { render: (props: ListArgs) => <NumberList {...props} current="Two" /> }

export const NoMatches = { render: (props: ListArgs) => <NumberList {...props} query="Five" /> }

export const Loading = {
  render: (props: ListArgs) => {
    const load = Promise.withResolvers<string[]>()

    return (
      <div>
        <List items={() => load.promise} key={(item) => item} search={props.search}>
          {(item) => item}
        </List>
        <button type="button" onClick={() => load.resolve(["One", "Two"])}>
          Finish loading
        </button>
      </div>
    )
  },
}

export const Grouped = {
  render: (props: ListArgs) => {
    const items = [
      { id: "a1", title: "Alpha", group: "Group A" },
      { id: "a2", title: "Bravo", group: "Group A" },
      { id: "b1", title: "Delta", group: "Group B" },
    ]

    return (
      <List items={items} key={(item) => item.id} groupBy={(item) => item.group} search={props.search}>
        {(item) => item.title}
      </List>
    )
  },
}

export const Empty = {
  render: (props: ListArgs) => (
    <List items={[]} key={(item: string) => item} search={props.search}>
      {(item) => item}
    </List>
  ),
}

export const LoadFailed = {
  render: (props: ListArgs) => (
    <List items={() => Promise.reject(new Error("offline"))} key={(item: string) => item} search={props.search}>
      {(item: string) => item}
    </List>
  ),
}

export const WithAdd = {
  render: (props: ListArgs) => (
    <List
      items={["One", "Two"]}
      key={(item) => item}
      search={props.search}
      add={{
        render: () => (
          <button type="button" data-slot="list-item">
            Add item
          </button>
        ),
      }}
    >
      {(item) => item}
    </List>
  ),
}

export const Divider = {
  args: { search: false },
  render: (props: ListArgs) => (
    <List items={["One", "Two", "Three"]} key={(item) => item} divider search={props.search}>
      {(item) => item}
    </List>
  ),
}

export const ActiveIcon = {
  args: { search: false },
  render: (props: ListArgs) => (
    <List items={["Alpha", "Beta", "Gamma"]} key={(item) => item} activeIcon="chevron-right" search={props.search}>
      {(item) => item}
    </List>
  ),
}

export const NoSearch = {
  args: { search: false },
  render: (props: ListArgs) => (
    <List items={["One", "Two", "Three"]} key={(item) => item} search={props.search}>
      {(item) => item}
    </List>
  ),
}

export const SearchOptions = {
  render: (props: ListArgs) => (
    <List
      items={["Apple", "Banana", "Cherry"]}
      key={(item) => item}
      search={
        props.search && {
          placeholder: "Filter...",
          hideIcon: true,
          action: <button type="button">Action</button>,
        }
      }
    >
      {(item) => item}
    </List>
  ),
}

export const ItemWrapper = {
  args: { search: false },
  render: (props: ListArgs) => (
    <List
      items={["One", "Two", "Three"]}
      key={(item) => item}
      search={props.search}
      itemWrapper={(_item, node) => (
        <div style={{ border: "1px solid var(--border-weak)", "border-radius": "6px", margin: "4px 0" }}>{node}</div>
      )}
    >
      {(item) => item}
    </List>
  ),
}

export const GroupHeader = {
  args: { search: false },
  render: (props: ListArgs) => {
    const items = [
      { id: "a1", title: "Alpha", group: "Group A" },
      { id: "b1", title: "Beta", group: "Group B" },
    ]

    return (
      <List
        items={items}
        key={(item) => item.id}
        groupBy={(item) => item.group}
        groupHeader={(group) => <strong>{group.category}</strong>}
        search={props.search}
      >
        {(item) => item.title}
      </List>
    )
  },
}
