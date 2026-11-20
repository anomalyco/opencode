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

/** Opens the dialog that chooses which MCP servers and skills the draft's session starts with. */
export function useNewSessionExtensionsDialog(input: { draftID: string; mcp: DraftMcpControls; onDone: () => void }) {
  const dialog = useDialog()

  return () =>
    void dialog.show(() => <NewSessionExtensionsDialog draftID={input.draftID} mcp={input.mcp} />, input.onDone)
}

function NewSessionExtensionsDialog(props: { draftID: string; mcp: DraftMcpControls }) {
  const language = useLanguage()
  const data = useData()
  const tabs = useTabs()
  const [query, setQuery] = createSignal("")

  const ref = () => ({ directory: props.mcp.directory() })
  const disabledSkills = () => tabs.draft(props.draftID).disabledSkills ?? []

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

  const results = createMemo(() => {
    const current = query().trim()

    if (!current) return items()

    return fuzzysort.go(current, items(), { keys: ["name"] }).map((result) => result.obj)
  })

  const checked = (item: Item) =>
    item.kind === "skill"
      ? !disabledSkills().includes(item.id)
      : (props.mcp.controls.states[item.id] ?? (item.status !== undefined && item.status !== "disabled"))

  const toggle = (item: Item, enabled: boolean) => {
    if (item.kind === "mcp") return props.mcp.controls.change(item.id, enabled)

    const others = disabledSkills().filter((id) => id !== item.id)
    tabs.updateDraft(props.draftID, { disabledSkills: enabled ? others : [...others, item.id] })
  }

  return (
    <Dialog class="command-palette command-palette-compact search-list-dialog mcp-dialog" size="large" fit>
      <div class="sr-only">
        <DialogTitle>{language.t("session.new.extensions.title")}</DialogTitle>
      </div>
      <DialogBody class="command-palette-body">
        <SearchList
          query={query()}
          onQuery={setQuery}
          placeholder={language.t("session.new.extensions.search.placeholder")}
          items={results()}
          key={(item) => item.key}
          section={(item) => item.kind}
          header={(item) => language.t(item.kind === "mcp" ? "dialog.mcp.title" : "settings.extensions.tab.skills")}
          empty={language.t("session.new.extensions.empty")}
          onSelect={(item) => toggle(item, !checked(item))}
        >
          {(item, row) => (
            <div {...row} data-option-key={item().key} data-size="compact">
              <span class="mcp-dialog-lead">
                <span class="mcp-dialog-status" aria-hidden="true">
                  <Show when={item().kind === "mcp"}>
                    <span class="mcp-status-dot" data-status={item().status} />
                  </Show>
                </span>
                <TruncatedText text={item().name} class="mcp-dialog-name" />
              </span>
              <div class="mcp-trailing" onClick={(event) => event.stopPropagation()}>
                <Switch
                  checked={checked(item())}
                  disabled={item().kind === "mcp" && props.mcp.controls.pending}
                  onChange={(enabled) => toggle(item(), enabled)}
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
