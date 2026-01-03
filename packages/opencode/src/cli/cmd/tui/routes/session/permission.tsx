import { createStore } from "solid-js/store"
import { createMemo, For, Match, Show, Switch } from "solid-js"
import { useKeyboard, useTerminalDimensions, type JSX } from "@opentui/solid"
import type { TextareaRenderable } from "@opentui/core"
import { useKeybind } from "../../context/keybind"
import { useTheme } from "../../context/theme"
import type { PermissionRequest } from "@opencode-ai/sdk/v2"
import { useSDK } from "../../context/sdk"
import { SplitBorder } from "../../component/border"
import { useSync } from "../../context/sync"
import { useTextareaKeybindings } from "../../component/textarea-keybindings"
import path from "path"
import { LANGUAGE_EXTENSIONS } from "@/lsp/language"
import { Locale } from "@/util/locale"
import { t } from "@/i18n"

type PermissionStage = "permission" | "always" | "reject"

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
        <text fg={theme.textMuted}>
          {t("permission.edit")} {normalizePath(filepath())}
        </text>
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

function TextBody(props: { title: string; description?: string; icon?: string }) {
  const { theme } = useTheme()
  return (
    <>
      <box flexDirection="row" gap={1} paddingLeft={1}>
        <Show when={props.icon}>
          <text fg={theme.textMuted} flexShrink={0}>
            {props.icon}
          </text>
        </Show>
        <text fg={theme.textMuted}>{props.title}</text>
      </box>
      <Show when={props.description}>
        <box paddingLeft={1}>
          <text fg={theme.text}>{props.description}</text>
        </box>
      </Show>
    </>
  )
}

export function PermissionPrompt(props: { request: PermissionRequest }) {
  const sdk = useSDK()
  const sync = useSync()
  const [store, setStore] = createStore({
    stage: "permission" as PermissionStage,
  })

  const session = createMemo(() => sync.data.session.find((s) => s.id === props.request.sessionID))

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
      <Match when={store.stage === "always"}>
        <Prompt
          title={t("permission.always_allow")}
          body={
            <Switch>
              <Match when={props.request.always.length === 1 && props.request.always[0] === "*"}>
                <TextBody title={t("permission.always_allow_desc", { permission: props.request.permission })} />
              </Match>
              <Match when={true}>
                <box paddingLeft={1} gap={1}>
                  <text fg={theme.textMuted}>{t("permission.always_allow_patterns")}</text>
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
          options={{ confirm: t("dialog.confirm"), cancel: t("dialog.cancel") }}
          escapeKey="cancel"
          onSelect={(option) => {
            setStore("stage", "permission")
            if (option === "cancel") return
            sdk.client.permission.reply({
              reply: "always",
              requestID: props.request.id,
            })
          }}
        />
      </Match>
      <Match when={store.stage === "reject"}>
        <RejectPrompt
          onConfirm={(message) => {
            sdk.client.permission.reply({
              reply: "reject",
              requestID: props.request.id,
              message: message || undefined,
            })
          }}
          onCancel={() => setStore("stage", "permission")}
        />
      </Match>
      <Match when={store.stage === "permission"}>
        <Prompt
          title={t("permission.title")}
          body={
            <Switch>
              <Match when={props.request.permission === "edit"}>
                <EditBody request={props.request} />
              </Match>
              <Match when={props.request.permission === "read"}>
                <TextBody icon="→" title={`${t("permission.read")} ` + normalizePath(input().filePath as string)} />
              </Match>
              <Match when={props.request.permission === "glob"}>
                <TextBody icon="✱" title={`${t("permission.glob")} "` + (input().pattern ?? "") + `"`} />
              </Match>
              <Match when={props.request.permission === "grep"}>
                <TextBody icon="✱" title={`${t("permission.grep")} "` + (input().pattern ?? "") + `"`} />
              </Match>
              <Match when={props.request.permission === "list"}>
                <TextBody icon="→" title={`${t("permission.list")} ` + normalizePath(input().path as string)} />
              </Match>
              <Match when={props.request.permission === "bash"}>
                <TextBody
                  icon="#"
                  title={(input().description as string) ?? ""}
                  description={("$ " + input().command) as string}
                />
              </Match>
              <Match when={props.request.permission === "task"}>
                <TextBody
                  icon="#"
                  title={`${Locale.titlecase((input().subagent_type as string) ?? t("permission.unknown"))} ${t("permission.task")}`}
                  description={"◉ " + input().description}
                />
              </Match>
              <Match when={props.request.permission === "webfetch"}>
                <TextBody icon="%" title={`${t("permission.webfetch")} ` + (input().url ?? "")} />
              </Match>
              <Match when={props.request.permission === "websearch"}>
                <TextBody icon="◈" title={`${t("permission.websearch")} "` + (input().query ?? "") + `"`} />
              </Match>
              <Match when={props.request.permission === "codesearch"}>
                <TextBody icon="◇" title={`${t("permission.codesearch")} "` + (input().query ?? "") + `"`} />
              </Match>
              <Match when={props.request.permission === "external_directory"}>
                <TextBody
                  icon="←"
                  title={`${t("permission.external_directory")} ` + normalizePath(input().path as string)}
                />
              </Match>
              <Match when={props.request.permission === "doom_loop"}>
                <TextBody icon="⟳" title={t("permission.doom_loop")} />
              </Match>
              <Match when={true}>
                <TextBody icon="⚙" title={`${t("permission.call_tool")} ` + props.request.permission} />
              </Match>
            </Switch>
          }
          options={{
            once: t("permission.allow_once"),
            always: t("permission.allow_always"),
            reject: t("permission.reject"),
          }}
          escapeKey="reject"
          onSelect={(option) => {
            if (option === "always") {
              setStore("stage", "always")
              return
            }
            if (option === "reject") {
              if (session()?.parentID) {
                setStore("stage", "reject")
                return
              }
              sdk.client.permission.reply({
                reply: "reject",
                requestID: props.request.id,
              })
            }
            sdk.client.permission.reply({
              reply: "once",
              requestID: props.request.id,
            })
          }}
        />
      </Match>
    </Switch>
  )
}

function RejectPrompt(props: { onConfirm: (message: string) => void; onCancel: () => void }) {
  let input: TextareaRenderable
  const { theme } = useTheme()
  const keybind = useKeybind()
  const textareaKeybindings = useTextareaKeybindings()

  useKeyboard((evt) => {
    if (evt.name === "escape" || keybind.match("app_exit", evt)) {
      evt.preventDefault()
      props.onCancel()
      return
    }
    if (evt.name === "return") {
      evt.preventDefault()
      props.onConfirm(input.plainText)
    }
  })

  return (
    <box
      backgroundColor={theme.backgroundPanel}
      border={["left"]}
      borderColor={theme.error}
      customBorderChars={SplitBorder.customBorderChars}
    >
      <box gap={1} paddingLeft={1} paddingRight={3} paddingTop={1} paddingBottom={1}>
        <box flexDirection="row" gap={1} paddingLeft={1}>
          <text fg={theme.error}>{"△"}</text>
          <text fg={theme.text}>{t("permission.reject_title")}</text>
        </box>
        <box paddingLeft={1}>
          <text fg={theme.textMuted}>{t("permission.reject_desc")}</text>
        </box>
      </box>
      <box
        flexDirection="row"
        flexShrink={0}
        paddingTop={1}
        paddingLeft={2}
        paddingRight={3}
        paddingBottom={1}
        backgroundColor={theme.backgroundElement}
        justifyContent="space-between"
      >
        <textarea
          ref={(val: TextareaRenderable) => (input = val)}
          focused
          textColor={theme.text}
          focusedTextColor={theme.text}
          cursorColor={theme.primary}
          keyBindings={textareaKeybindings()}
        />
        <box flexDirection="row" gap={2} flexShrink={0} marginLeft={1}>
          <text fg={theme.text}>
            {t("misc.enter")} <span style={{ fg: theme.textMuted }}>{t("misc.confirm")}</span>
          </text>
          <text fg={theme.text}>
            {t("dialog.esc")} <span style={{ fg: theme.textMuted }}>{t("dialog.cancel")}</span>
          </text>
        </box>
      </box>
    </box>
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
            {"⇆"} <span style={{ fg: theme.textMuted }}>{t("permission.select")}</span>
          </text>
          <text fg={theme.text}>
            {t("misc.enter")} <span style={{ fg: theme.textMuted }}>{t("misc.confirm")}</span>
          </text>
        </box>
      </box>
    </box>
  )
}
