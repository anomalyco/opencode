import { For } from "solid-js"
import { createStore } from "solid-js/store"
import { CurrentSessionProviders } from "../storybook/current-session-story"
import { storyDocument, storyTool } from "../storybook/current-session-scenarios"
import { SessionAssistantContent } from "../message/current-message"
import type { SessionMessageAssistant } from "@opencode/client/promise"

export default { title: "OpenCode/Work/Tool elapsed", id: "tool-elapsed", parameters: { layout: "fullscreen" } }

export const RunningAndFinished = {
  render: () => {
    const started = Date.now() - 2000
    const [state, setState] = createStore<{ completed?: number }>({})
    const tools = () => [
      {
        ...storyTool("elapsed_shell", "shell", state.completed === undefined ? "running" : "completed", {
          command: "sleep 5",
        }),
        time: { created: started - 5000, ran: started, completed: state.completed },
      },
      {
        ...storyTool("elapsed_generic", "plugin_tool", state.completed === undefined ? "running" : "completed", {}),
        time: { created: started - 5000, ran: started, completed: state.completed },
      },
      {
        ...storyTool("elapsed_error", "shell", "error", { command: "failed command" }, { error: "Command failed" }),
        time: { created: started - 5000, ran: started, completed: started + 1234 },
      },
      { ...storyTool("elapsed_pending", "plugin_tool", "streaming", {}), time: { created: started } },
    ]
    const message = (): SessionMessageAssistant => ({
      id: "msg_elapsed",
      type: "assistant",
      agent: "build",
      model: { providerID: "test", modelID: "test" },
      content: tools(),
      time: { created: started },
    })
    return (
      <section class="mx-auto max-w-[720px] p-6 flex flex-col gap-4">
        <button onClick={() => setState("completed", Date.now())}>Complete tools</button>
        <CurrentSessionProviders document={storyDocument([])}>
          <For each={tools()}>
            {(tool) => <SessionAssistantContent message={message()} content={tool} contentID={tool.id} />}
          </For>
        </CurrentSessionProviders>
      </section>
    )
  },
}
