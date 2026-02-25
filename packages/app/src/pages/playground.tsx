import { Show } from "solid-js"
import { useNavigate, useParams } from "@solidjs/router"
import { useSDK } from "@/context/sdk"
import { usePlayground } from "@/context/playground"
import { Canvas } from "./playground/canvas"
import { PlaygroundPrompt } from "./playground/prompt"
import { PlaygroundHeader } from "./playground/header"
import { PlaygroundTitlebar } from "./playground/playground-titlebar"
import { ChatDrawer } from "./playground/chat-drawer"
import { CodeDrawer } from "./playground/code-drawer"
import { extractCodeBlock } from "./playground/code-parser"
import { PLAYGROUND_SYSTEM_PROMPT } from "./playground/sandbox"

const MAX_AUTO_FIX = 3

export default function Playground() {
  const params = useParams()
  const navigate = useNavigate()
  const sdk = useSDK()
  const playground = usePlayground()

  async function handleSubmit(text: string) {
    playground.setGenerating(true)
    try {
      const sel = playground.selected
      const model = sel?.model ?? { providerID: "opencode", modelID: "opencode/best" }

      let sessionID = params.id
      if (!sessionID) {
        const result = await sdk.client.session.create({ directory: sdk.directory })
        sessionID = result.data?.id
        if (!sessionID) return
        navigate(`/${params.dir}/playground/${sessionID}`, { replace: true })
      }

      const systemPrompt = sel
        ? `${PLAYGROUND_SYSTEM_PROMPT}\n\nThe user wants to modify an existing app titled "${sel.title}". Here is the current code:\n\`\`\`html\n${sel.code}\n\`\`\`\n\nOutput the COMPLETE updated HTML.`
        : PLAYGROUND_SYSTEM_PROMPT

      let fullText = ""

      const unsub = sdk.event.on("message.part.delta", (event: any) => {
        const delta = event.properties?.part?.delta
        if (!delta) return
        fullText += delta
        const parsed = extractCodeBlock(fullText)
        if (parsed.code) {
          if (sel) {
            playground.updateWindow(sel.id, {
              code: parsed.code,
              title: parsed.title ?? sel.title,
              streaming: true,
            })
          }
        }
      })

      const unsub2 = sdk.event.on("message.part.updated", (event: any) => {
        if (event.properties?.part?.type !== "text") return
        const text = event.properties.part.text ?? ""
        if (text) fullText = text
      })

      await sdk.client.session.promptAsync({
        sessionID,
        parts: [{ type: "text", text }],
        system: systemPrompt,
        model,
        tools: {},
      })

      unsub()
      unsub2()

      const parsed = extractCodeBlock(fullText)
      if (parsed.code) {
        if (sel) {
          playground.updateWindow(sel.id, {
            code: parsed.code,
            title: parsed.title ?? sel.title,
            streaming: false,
          })
        } else {
          const title = parsed.title ?? "Untitled App"
          const winSession = await sdk.client.session.create({
            directory: sdk.directory,
          })
          playground.createWindow({
            code: parsed.code,
            title,
            model,
            sessionID: winSession.data?.id ?? sessionID,
          })
        }
      }
    } finally {
      playground.setGenerating(false)
    }
  }

  function handleStop() {
    playground.setGenerating(false)
  }

  function handleError(windowId: string, message: string) {
    const win = playground.windows.find((w) => w.id === windowId)
    if (!win) return
    playground.updateWindow(windowId, { error: message })

    if (win.fixAttempts < MAX_AUTO_FIX) {
      playground.updateWindow(windowId, { fixAttempts: win.fixAttempts + 1 })
      const fixPrompt = `Error in "${win.title}": ${message}\n\nHere's the current code:\n\`\`\`html\n${win.code}\n\`\`\`\n\nFix the error and output the COMPLETE updated HTML.`
      playground.selectWindow(windowId)
      void handleSubmit(fixPrompt)
    }
  }

  function handleElementSelected(selector: string, tagName: string, textContent: string) {
    // Element selection will pre-fill the prompt — handled by the prompt component
  }

  return (
    <div class="flex flex-col size-full overflow-hidden" data-component="playground">
      <PlaygroundTitlebar />
      <PlaygroundHeader />
      <div class="flex flex-1 min-h-0 relative">
        <Canvas onError={handleError} onElementSelected={handleElementSelected} />
        <Show when={playground.panel === "chat"}>
          <ChatDrawer />
        </Show>
        <Show when={playground.panel === "code"}>
          <CodeDrawer />
        </Show>
        <PlaygroundPrompt onSubmit={handleSubmit} onStop={handleStop} />
      </div>
    </div>
  )
}
