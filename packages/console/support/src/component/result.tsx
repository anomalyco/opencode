import { For, Show } from "solid-js"
import type { LookupResult, WorkspaceSection } from "~/lib/lookup"

export function Result(props: { data: LookupResult }) {
  return (
    <>
      <Show when={props.data.auth}>
        {(auth) => (
          <section data-component="section">
            <h2>Auth</h2>
            <DataTable rows={auth()} />
          </section>
        )}
      </Show>

      <Show when={props.data.accountWorkspaces}>
        {(workspaces) => (
          <section data-component="section">
            <h2>Workspaces</h2>
            <DataTable rows={workspaces()} />
          </section>
        )}
      </Show>

      <For each={props.data.workspaces}>{(ws) => <WorkspaceView section={ws} />}</For>
    </>
  )
}

function WorkspaceView(props: { section: WorkspaceSection }) {
  return (
    <section data-component="section" id={`workspace-${props.section.workspaceID}`}>
      <h2>{props.section.title}</h2>

      <h3>Users</h3>
      <DataTable rows={props.section.users} />

      <h3>Billing</h3>
      <DataTable rows={props.section.billing ? [props.section.billing] : []} />

      <h3>GO</h3>
      <DataTable rows={props.section.go} />

      <h3>Payments</h3>
      <DataTable rows={props.section.payments} />

      <h3>28-Day Usage</h3>
      <DataTable rows={props.section.usage} />

      <h3>Disabled Models</h3>
      <DataTable rows={props.section.disabledModels} />
    </section>
  )
}

function DataTable(props: { rows: Record<string, unknown>[] }) {
  const columns = () => {
    const cols = new Set<string>()
    for (const row of props.rows) {
      for (const key of Object.keys(row)) cols.add(key)
    }
    return [...cols]
  }

  return (
    <Show when={props.rows.length > 0} fallback={<div data-empty>(no data)</div>}>
      <table>
        <thead>
          <tr>
            <For each={columns()}>{(col) => <th>{col}</th>}</For>
          </tr>
        </thead>
        <tbody>
          <For each={props.rows}>
            {(row) => (
              <tr>
                <For each={columns()}>{(col) => <td>{renderCell(row[col])}</td>}</For>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </Show>
  )
}

function renderCell(value: unknown) {
  if (value === null || value === undefined) return ""
  if (typeof value === "string" && value.startsWith("https://")) {
    return (
      <a href={value} target="_blank" rel="noopener noreferrer">
        {value}
      </a>
    )
  }
  if (isLinkCell(value)) {
    const external = value.__link.startsWith("http")
    return (
      <a
        href={value.__link}
        target={external ? "_blank" : undefined}
        rel={external ? "noopener noreferrer" : undefined}
      >
        {value.label}
      </a>
    )
  }
  if (typeof value === "object") return JSON.stringify(value)
  return String(value)
}

function isLinkCell(value: unknown): value is { __link: string; label: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "__link" in value &&
    typeof (value as { __link: unknown }).__link === "string"
  )
}
