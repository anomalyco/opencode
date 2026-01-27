import { Component, For, createSignal, Show } from 'solid-js'
import { useServer } from '@/context/server'
import styles from './ToolCallMonitor.module.css'
import type { ToolCall } from './TaskTimeline'

export const ToolCallMonitor: Component = () => {
  const [activeCalls, setActiveCalls] = createSignal<ToolCall[]>([])

  // TODO: Integrate with SSE events from OpenCode server
  // Listen for tool call events and update activeCalls

  return (
    <div class={styles.monitor}>
      <h3>Active Tool Calls</h3>
      <Show when={activeCalls().length === 0}>
        <div class={styles.empty}>No active tool calls</div>
      </Show>
      <For each={activeCalls()}>
        {(call) => (
          <div class={styles.call}>
            <div class={styles.name}>{call.name}</div>
            <div class={styles.status}>
              {call.result ? 'Completed' : 'Running...'}
            </div>
            <pre class={styles.params}>
              {JSON.stringify(call.parameters, null, 2)}
            </pre>
          </div>
        )}
      </For>
    </div>
  )
}
