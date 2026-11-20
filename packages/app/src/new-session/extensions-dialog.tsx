import { Dialog, DialogBody, DialogTitle } from "@opencode/ui/dialog"
import { useDialog } from "@opencode/ui/context/dialog"
import { SearchList } from "@opencode/ui/search-list"
import { Switch } from "@opencode/ui/switch"
import { TruncatedText } from "@opencode/ui/truncated-text"
import fuzzysort from "fuzzysort"
import { createEffect, createMemo, createSignal, Show } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { useData } from "@/runtime/server/current"
import { useTabs } from "@/shell/tabs/tabs"
import type { DraftMcpControls } from "./mcp"
import "@/shell/commands/dialog.css"
import "@/shell/search-list.css"

type Item = { key: string; kind: "mcp" | "skill"; id: string; name: string; status?: string }

/** The draft's MCP servers and skills with whether each starts enabled, shared by the trigger's counts and the dialog. */
export function createNewSessionExtensions(input: { draftID: string; mcp: DraftMcpControls }) {
  const data = useData()
  const tabs = useTabs()

  const ref = () => ({ directory: input.mcp.directory() })
  const disabledSkills = () => tabs.draft(input.draftID).disabledSkills ?? []

  createEffect(() => {
    void Promise.all([data.location.mcp.server.sync(ref()), data.location.skill.sync(ref())]).catch(() => undefined)
  })

  const items = createMemo(() => {
    const servers = (data.location.mcp.server.list(ref()) ?? []).map(
      (server): Item => ({
        key: `mcp:${server.name}`,
        kind: "mcp",
        id: server.name,
        name: server.name,
        status: server.status.status,
      }),
    )

    const skills = (data.location.skill.list(ref()) ?? []).map(
      (skill): Item => ({ key: `skill:${skill.id}`, kind: "skill", id: skill.id, name: skill.name }),
    )

    return [servers, skills].flatMap((list) => list.toSorted((a, b) => a.name.localeCompare(b.name)))
  })

  const checked = (item: Item) =>
    item.kind === "skill"
      ? !disabledSkills().includes(item.id)
      : (input.mcp.controls.states[item.id] ?? (item.status !== undefined && item.status !== "disabled"))

  const toggle = (item: Item, enabled: boolean) => {
    if (item.kind === "mcp") return input.mcp.controls.change(item.id, enabled)

    const others = disabledSkills().filter((id) => id !== item.id)
    tabs.updateDraft(input.draftID, { disabledSkills: enabled ? others : [...others, item.id] })
  }

  const counts = createMemo(() => ({
    mcps: items().filter((item) => item.kind === "mcp" && checked(item)).length,
    skills: items().filter((item) => item.kind === "skill" && checked(item)).length,
  }))

  return { items, checked, toggle, counts, pending: () => input.mcp.controls.pending }
}

export type NewSessionExtensions = ReturnType<typeof createNewSessionExtensions>

type Kind = Item["kind"]

/** Opens the dialog that chooses which MCP servers, or which skills, the draft's session starts with. */
export function useNewSessionExtensionsDialog(input: { extensions: NewSessionExtensions; onDone: () => void }) {
  const dialog = useDialog()

  return {
    counts: input.extensions.counts,
    open: (kind: Kind) =>
      void dialog.show(() => <NewSessionExtensionsDialog kind={kind} extensions={input.extensions} />, input.onDone),
  }
}

function NewSessionExtensionsDialog(props: { kind: Kind; extensions: NewSessionExtensions }) {
  const language = useLanguage()
  const [query, setQuery] = createSignal("")
  const mcp = props.kind === "mcp"

  const items = createMemo(() => props.extensions.items().filter((item) => item.kind === props.kind))

  const results = createMemo(() => {
    const current = query().trim()

    if (!current) return items()

    return fuzzysort.go(current, items(), { keys: ["name"] }).map((result) => result.obj)
  })

  return (
    <Dialog class="command-palette command-palette-compact search-list-dialog mcp-dialog" size="large" fit>
      <div class="sr-only">
        <DialogTitle>{language.t(mcp ? "dialog.mcp.title" : "settings.extensions.tab.skills")}</DialogTitle>
      </div>
      <DialogBody class="command-palette-body">
        <SearchList
          query={query()}
          onQuery={setQuery}
          placeholder={language.t(mcp ? "dialog.mcp.search.placeholder" : "session.new.skills.search.placeholder")}
          items={results()}
          key={(item) => item.key}
          empty={language.t(
            items().length > 0
              ? mcp
                ? "dialog.mcp.search.empty"
                : "session.new.skills.search.empty"
              : mcp
                ? "dialog.mcp.empty"
                : "session.new.skills.empty",
          )}
          onSelect={(item) => props.extensions.toggle(item, !props.extensions.checked(item))}
        >
          {(item, row) => (
            <div {...row} data-option-key={item().key} data-size="compact">
              <span class="mcp-dialog-lead">
                <Show when={mcp}>
                  <span class="mcp-dialog-status" aria-hidden="true">
                    <span class="mcp-status-dot" data-status={item().status} />
                  </span>
                </Show>
                <TruncatedText text={item().name} class="mcp-dialog-name" />
              </span>
              <div class="mcp-trailing" onClick={(event) => event.stopPropagation()}>
                <Switch
                  checked={props.extensions.checked(item())}
                  disabled={mcp && props.extensions.pending()}
                  onChange={(enabled) => props.extensions.toggle(item(), enabled)}
                >
                  <span class="sr-only">{item().name}</span>
                </Switch>
              </div>
            </div>
          )}
        </SearchList>
      </DialogBody>
    </Dialog>
  )
}
