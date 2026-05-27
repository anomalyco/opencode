/**
 * 专利检索结果侧边栏面板
 */

import type { TuiPluginApi } from "@yunpat/plugin/tui"
import { createMemo, Show, For } from "solid-js"

interface Props {
  api: TuiPluginApi
  sessionId: string
}

function extractPatentsFromText(text: string): Array<{
  name: string
  appNumber: string
  applicant: string
  ipc: string
}> {
  const patents: ReturnType<typeof extractPatentsFromText> = []
  const lines = text.split("\n")
  let current: (typeof patents)[0] | null = null

  for (const line of lines) {
    const nameMatch = line.match(/^\d+\.\s*\*\*(.+?)\*\*/)
    if (nameMatch) {
      if (current) patents.push(current)
      current = { name: nameMatch[1], appNumber: "", applicant: "", ipc: "" }
    }
    if (current && line.includes("申请号")) current.appNumber = line.split("：")[1]?.trim() || ""
    if (current && line.includes("申请人")) current.applicant = line.split("：")[1]?.trim() || ""
    if (current && line.includes("IPC")) current.ipc = line.split("：")[1]?.trim() || ""
  }
  if (current) patents.push(current)
  return patents
}

export function PatentSearchPanel(props: Props) {
  const theme = () => props.api.theme.current

  const patentResults = createMemo(() => {
    const messages = props.api.state.session.messages(props.sessionId)
    const results: Array<{ query: string; patents: ReturnType<typeof extractPatentsFromText> }> = []

    for (const msg of messages) {
      if (msg.role !== "assistant") continue
      const parts = props.api.state.part(msg.id) as any[]
      for (const part of parts) {
        // Tool output is typically in text parts following the tool call
        if (part.type === "text") {
          const text = part.text || ""
          if (text.includes("专利检索结果") || text.includes("申请号")) {
            const patents = extractPatentsFromText(text)
            if (patents.length) results.push({ query: "专利检索", patents })
          }
        }
      }
    }
    return results
  })

  const latest = createMemo(() => patentResults()[patentResults().length - 1])

  return (
    <Show when={patentResults().length > 0}>
      <box gap={1}>
        <text fg={theme().primary}>
          <b>专利检索</b>
        </text>
        <text fg={theme().textMuted}>{latest()?.query || ""}</text>
        <For each={latest()?.patents || []}>
          {(p, i) => (
            <box>
              <text fg={theme().text}>{i() + 1}. {p.name.slice(0, 30)}</text>
              <text fg={theme().textMuted}>  {p.appNumber} | {p.applicant.slice(0, 15)}</text>
            </box>
          )}
        </For>
      </box>
    </Show>
  )
}
