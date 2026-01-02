import { createStore } from "solid-js/store"
import { createMemo, For, Match, Show, Switch } from "solid-js"
import { useKeyboard, useTerminalDimensions, type JSX } from "@opentui/solid"
import { useKeybind } from "../../context/keybind"
import { useTheme } from "../../context/theme"
import type { PermissionRequest } from "@opencode-ai/sdk/v2"
import { useSDK } from "../../context/sdk"
import { SplitBorder } from "../../component/border"
import { useSync } from "../../context/sync"
import path from "path"
import { LANGUAGE_EXTENSIONS } from "@/lsp/language"
import { Locale } from "@/util/locale"

function normalizePath(input?: string) {
  if (!input) return ""
  if (path.isAbsolute(input)) {
    return path.relative(process.cwd(), input) || "."
  }
  return input
}

function filetype(input?: string) {
  if (!input) return "none"
  const ext = path.extname(input)
  const language = LANGUAGE_EXTENSIONS[ext]
  if (["typescriptreact", "javascriptreact", "javascript"].includes(language)) return "typescript"
  return language
}

function EditBody(props: { request: PermissionRequest }) {
  const { theme, syntax } = useTheme()
  const sync = useSync()
  const dimensions = useTerminalDimensions()

  const filepath = createMemo(() => (props.request.metadata?.filepath as string) ?? "")
  const diff = createMemo(() => (props.request.metadata?.diff as string) ?? "")

  const view = createMemo(() => {
    const diffStyle = sync.data.config.tui?.diff_style
    if (diffStyle === "stacked") return "unified"
    return dimensions().width > 120 ? "split" : "unified"
  })

  const ft = createMemo(() => filetype(filepath()))

  return (
    <box flexDirection="column" gap={1}>
      <box flexDirection="row" gap={1} paddingLeft={1}>
        <text fg={theme.textMuted}>{"→"}</text>
        <text fg={theme.textMuted}>Edit {normalizePath(filepath())}</text>
      </box>
      <Show when={diff()}>
        <box maxHeight={Math.floor(dimensions().height / 4)} overflow="scroll">
          <diff
            diff={diff()}
            view={view()}
            filetype={ft()}
            syntaxStyle={syntax()}
            showLineNumbers={true}
            width="100%"
            wrapMode="word"
            fg={theme.text}
            addedBg={theme.diffAddedBg}
            removedBg={theme.diffRemovedBg}
            contextBg={theme.diffContextBg}
            addedSignColor={theme.diffHighlightAdded}
            removedSignColor={theme.diffHighlightRemoved}
            lineNumberFg={theme.diffLineNumber}
            lineNumberBg={theme.diffContextBg}
            addedLineNumberBg={theme.diffAddedLineNumberBg}
            removedLineNumberBg={theme.diffRemovedLineNumberBg}
          />
        </box>
      </Show>
    </box>
  )
}

function PermissionBody(props: { icon?: string; title: string; children?: any }) {
  const { theme } = useTheme()
  return (
    <box flexDirection="column" gap={0}>
      <box flexDirection="row" gap={1} paddingLeft={1}>
        <Show when={props.icon}>
          <text fg={theme.textMuted} flexShrink={0}>
            {props.icon}
          </text>
        </Show>
        <text fg={theme.textMuted}>{props.title}</text>
      </box>
      <Show when={props.children}>
        <box paddingLeft={3}>{props.children}</box>
      </Show>
    </box>
  )
}

export function PermissionPrompt(props: { request: PermissionRequest }) {
  const sdk = useSDK()
  const sync = useSync()
  const [store, setStore] = createStore({
    always: false,
  })

  const input = createMemo(() => {
    const tool = props.request.tool
    if (!tool) return {}
    const parts = sync.data.part[tool.messageID] ?? []
    for (const part of parts) {
      if (part.type === "tool" && part.callID === tool.callID && part.state.status !== "pending") {
        return part.state.input ?? {}
      }
    }
    return {}
  })

  const { theme } = useTheme()

  return (
    <Switch>
      <Match when={store.always}>
        <Prompt
          title="Always allow"
          body={
            <Switch>
              <Match when={props.request.always.length === 1 && props.request.always[0] === "*"}>
                <PermissionBody
                  title={"This will allow " + props.request.permission + " until OpenCode is restarted."}
                />
              </Match>
              <Match when={true}>
                <box paddingLeft={1} gap={1}>
                  <text fg={theme.textMuted}>This will allow the following patterns until OpenCode is restarted</text>
                  <box>
                    <For each={props.request.always}>
                      {(pattern) => (
                        <text fg={theme.text}>
                          {"- "}
                          {pattern}
                        </text>
                      )}
                    </For>
                  </box>
                </box>
              </Match>
            </Switch>
          }
          options={{ confirm: "Confirm", cancel: "Cancel" }}
          escapeKey="cancel"
          onSelect={(option) => {
            setStore("always", false)
            if (option === "cancel") return
            sdk.client.permission.reply({
              reply: "always",
              requestID: props.request.id,
            })
          }}
        />
      </Match>
      <Match when={!store.always}>
        <Prompt
          title={`Permission required (${props.request.permission})`}
          body={
            <Switch>
              <Match when={props.request.permission === "edit"}>
                <EditBody request={props.request} />
              </Match>
              <Match when={props.request.permission === "read"}>
                <PermissionBody
                  icon="→"
                  title={
                    `Read ` +
                    normalizePath((props.request.metadata?.filepath as string) ?? (input().filePath as string) ?? "")
                  }
                />
              </Match>
              <Match when={props.request.permission === "glob"}>
                <PermissionBody
                  icon="✱"
                  title={`Glob "` + (props.request.metadata?.pattern ?? input().pattern ?? "") + `"`}
                />
              </Match>
              <Match when={props.request.permission === "grep"}>
                <PermissionBody
                  icon="✱"
                  title={`Grep "` + (props.request.metadata?.pattern ?? input().pattern ?? "") + `"`}
                />
              </Match>
              <Match when={props.request.permission === "list"}>
                <PermissionBody
                  icon="→"
                  title={
                    `List ` + normalizePath((props.request.metadata?.path as string) ?? (input().path as string) ?? "")
                  }
                />
              </Match>
              <Match when={props.request.permission === "bash"}>
                <PermissionBody icon="#" title={(input().description as string) ?? "Run bash command"}>
                  <box flexDirection="column" gap={0}>
                    <For each={props.request.patterns as string[]}>
                      {(pattern) => (
                        <box flexDirection="row" gap={1}>
                          <text fg={theme.text}>•</text>
                          <text fg={theme.text}>{pattern}</text>
                        </box>
                      )}
                    </For>
                    <Show when={!props.request.patterns?.length && (input().command as string)}>
                      <text fg={theme.text}>{input().command}</text>
                    </Show>
                  </box>
                </PermissionBody>
              </Match>
              <Match when={props.request.permission === "task"}>
                <PermissionBody
                  icon="#"
                  title={`${Locale.titlecase((input().subagent_type as string) ?? "Unknown")} Task`}
                >
                  <text fg={theme.text}>{"◉ " + ((input().description as string) ?? "")}</text>
                </PermissionBody>
              </Match>
              <Match when={props.request.permission === "webfetch"}>
                <PermissionBody icon="%" title={`WebFetch ` + (props.request.metadata?.url ?? input().url ?? "")} />
              </Match>
              <Match when={props.request.permission === "websearch"}>
                <PermissionBody
                  icon="◈"
                  title={`Exa Web Search "` + (props.request.metadata?.query ?? input().query ?? "") + `"`}
                />
              </Match>
              <Match when={props.request.permission === "codesearch"}>
                <PermissionBody
                  icon="◇"
                  title={`Exa Code Search "` + (props.request.metadata?.query ?? input().query ?? "") + `"`}
                />
              </Match>
              <Match when={props.request.permission === "external_directory"}>
                <PermissionBody icon="←" title={`Access external directory`}>
                  <text fg={theme.text}>
                    {normalizePath(
                      (props.request.metadata?.filepath as string) ??
                        (props.request.metadata?.parentDir as string) ??
                        (input().path as string) ??
                        "",
                    )}
                  </text>
                </PermissionBody>
              </Match>
              <Match when={props.request.permission === "patch"}>
                <PermissionBody
                  icon="◧"
                  title={
                    `Apply patch to ` +
                    normalizePath((props.request.metadata?.filePath as string) ?? (input().patchText ? "(patch)" : ""))
                  }
                />
              </Match>
              <Match when={props.request.permission === "write"}>
                <PermissionBody
                  icon="✎"
                  title={
                    `Write to ` +
                    normalizePath((props.request.metadata?.filepath as string) ?? (input().filePath as string) ?? "")
                  }
                />
              </Match>
              <Match when={props.request.permission === "skill"}>
                <PermissionBody icon="◎" title={`Run skill`}>
                  <text fg={theme.text}>
                    {(props.request.metadata?.skill as string) ??
                      (input().name as string) ??
                      (input().skill as string) ??
                      ""}
                  </text>
                </PermissionBody>
              </Match>
              <Match when={props.request.permission === "todowrite"}>
                <PermissionBody icon="☑" title={`Update todos`}>
                  <text fg={theme.text}>{`${props.request.metadata?.count ?? "todo"} items`}</text>
                </PermissionBody>
              </Match>
              <Match when={props.request.permission === "todoread"}>
                <PermissionBody icon="☑" title={`Read todos`} />
              </Match>
              <Match when={true}>
                <PermissionBody icon="⚙" title={`Call tool ` + props.request.permission} />
              </Match>
            </Switch>
          }
          options={{ once: "Allow once", always: "Allow always", reject: "Reject" }}
          escapeKey="reject"
          onSelect={(option) => {
            if (option === "always") {
              setStore("always", true)
              return
            }
            sdk.client.permission.reply({
              reply: option as "once" | "reject",
              requestID: props.request.id,
            })
          }}
        />
      </Match>
    </Switch>
  )
}

function Prompt<const T extends Record<string, string>>(props: {
  title: string
  body: JSX.Element
  options: T
  escapeKey?: keyof T
  onSelect: (option: keyof T) => void
}) {
  const { theme } = useTheme()
  const keybind = useKeybind()
  const keys = Object.keys(props.options) as (keyof T)[]
  const [store, setStore] = createStore({
    selected: keys[0],
  })

  useKeyboard((evt) => {
    if (evt.name === "left" || evt.name == "h") {
      evt.preventDefault()
      const idx = keys.indexOf(store.selected)
      const next = keys[(idx - 1 + keys.length) % keys.length]
      setStore("selected", next)
    }

    if (evt.name === "right" || evt.name == "l") {
      evt.preventDefault()
      const idx = keys.indexOf(store.selected)
      const next = keys[(idx + 1) % keys.length]
      setStore("selected", next)
    }

    if (evt.name === "return") {
      evt.preventDefault()
      props.onSelect(store.selected)
    }

    if (props.escapeKey && (evt.name === "escape" || keybind.match("app_exit", evt))) {
      evt.preventDefault()
      props.onSelect(props.escapeKey)
    }
  })

  return (
    <box
      backgroundColor={theme.backgroundPanel}
      border={["left"]}
      borderColor={theme.warning}
      customBorderChars={SplitBorder.customBorderChars}
    >
      <box gap={1} paddingLeft={1} paddingRight={3} paddingTop={1} paddingBottom={1}>
        <box flexDirection="row" gap={1} paddingLeft={1}>
          <text fg={theme.warning}>{"△"}</text>
          <text fg={theme.text}>{props.title}</text>
        </box>
        {props.body}
      </box>
      <box
        flexDirection="row"
        flexShrink={0}
        gap={1}
        paddingTop={1}
        paddingLeft={2}
        paddingRight={3}
        paddingBottom={1}
        backgroundColor={theme.backgroundElement}
        justifyContent="space-between"
      >
        <box flexDirection="row" gap={1}>
          <For each={keys}>
            {(option) => (
              <box
                paddingLeft={1}
                paddingRight={1}
                backgroundColor={option === store.selected ? theme.warning : theme.backgroundMenu}
              >
                <text fg={option === store.selected ? theme.selectedListItemText : theme.textMuted}>
                  {props.options[option]}
                </text>
              </box>
            )}
          </For>
        </box>
        <box flexDirection="row" gap={2}>
          <text fg={theme.text}>
            {"⇆"} <span style={{ fg: theme.textMuted }}>select</span>
          </text>
          <text fg={theme.text}>
            enter <span style={{ fg: theme.textMuted }}>confirm</span>
          </text>
        </box>
      </box>
    </box>
  )
}
