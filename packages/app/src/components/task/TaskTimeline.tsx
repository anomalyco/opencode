import { Component, For, Show } from 'solid-js'
import { useServer } from '@/context/server'
import styles from './TaskTimeline.module.css'

export interface TaskStep {
  id: string
  title: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  startTime?: Date
  endTime?: Date
  toolCalls?: ToolCall[]
}

export interface ToolCall {
  id: string
  name: string
  parameters: Record<string, unknown>
  result?: unknown
  error?: string
}

export const TaskTimeline: Component<{ steps: TaskStep[] }> = (props) => {
  const server = useServer()

  return (
    <div class={styles.timeline}>
      <For each={props.steps}>
        {(step) => (
          <div class={styles.step} classList={{
            [styles.completed]: step.status === 'completed',
            [styles.running]: step.status === 'running',
            [styles.failed]: step.status === 'failed',
            [styles.pending]: step.status === 'pending'
          }}>
            <div class={styles.icon}>
              {step.status === 'completed' && '✓'}
              {step.status === 'running' && '🔄'}
              {step.status === 'failed' && '✗'}
              {step.status === 'pending' && '⏳'}
            </div>
            <div class={styles.content}>
              <div class={styles.title}>{step.title}</div>
              <Show when={step.startTime}>
                <div class={styles.time}>
                  {step.startTime?.toLocaleTimeString()}
                </div>
              </Show>
            </div>
          </div>
        )}
      </For>
    </div>
  )
}
