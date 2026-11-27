import { createSignal, Show } from "solid-js"
import { render } from "solid-js/web"
import type { SessionMessageAssistantText, SessionMessageAssistantTool } from "@opencode/client/promise"
import { activePermissionRequest, permissionPendingDocument } from "@opencode/session-ui/lab"
import { timelinePresets } from "@opencode/session-ui/timeline/detail"
import { DialogProvider } from "@opencode/ui/context/dialog"
import { ThemeProvider } from "@opencode/ui/theme"
import { LanguageProvider, UiI18nBridge } from "../src/runtime/i18n/language"
import { SettingsProvider } from "../src/settings/model"
import { SessionPreview } from "../src/session/lab-model"

const [pending, setPending] = createSignal(true)

// The complete session workspace with a pending tool permission, and one authored message in its history: as the
// assistant's text, or as the output of a tool whose renderer shows Markdown.
export function mountContainment(markup: string, delivery: "text" | "tool") {
  const host = document.createElement("div")
  host.dataset.testid = "containment-fixture"
  host.style.cssText = "position:fixed;inset:0"
  document.body.append(host)
  document.getElementById("lab-root")?.style.setProperty("display", "none")
  const [user, assistant] = permissionPendingDocument.messages

  if (!user || assistant?.type !== "assistant") throw new Error("The permission document changed shape.")
  const created = assistant.time.created
  const text: SessionMessageAssistantText = { type: "text", text: markup }

  const tool: SessionMessageAssistantTool = {
    type: "tool",
    id: "tool_containment_list",
    name: "list",
    state: { status: "completed", input: { path: "." }, content: [{ type: "text", text: markup }] },
    time: { created: created + 10, ran: created + 20, completed: created + 30 },
  }

  const history = {
    ...permissionPendingDocument,
    messages: [user, { ...assistant, content: [delivery === "text" ? text : tool, ...assistant.content] }],
  }

  // Tools as their own rows, so the tool's Markdown output can be opened.
  const detail = timelinePresets[0].value

  // The preview keeps its first request, so the answered state is a fresh workspace with the same history.
  render(
    () => (
      <ThemeProvider>
        <LanguageProvider locale="en">
          <UiI18nBridge>
            <SettingsProvider>
              <DialogProvider>
                <Show
                  when={pending()}
                  fallback={
                    <SessionPreview title="Containment" description="opencode" document={history} timelineDetail={detail} />
                  }
                >
                  <SessionPreview
                    title="Containment"
                    description="opencode"
                    document={history}
                    timelineDetail={detail}
                    request={{ type: "permission", value: activePermissionRequest }}
                  />
                </Show>
              </DialogProvider>
            </SettingsProvider>
          </UiI18nBridge>
        </LanguageProvider>
      </ThemeProvider>
    ),
    host,
  )
}

/** The permission is answered: the dock gives way to the composer. */
export function answerPermission() {
  setPending(false)
}
