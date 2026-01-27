import { Component, For, Show, Switch, Match } from 'solid-js'
import { useServer } from '@opencode-ai/app/context/server'
import styles from './StepVisualization.module.css'

export interface FileChange {
  path: string
  operation: 'create' | 'update' | 'delete'
  diff?: string
}

export interface StepDetail {
  step: TaskStep
  fileChanges?: FileChange[]
  stackTrace?: string
}

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
  startTime?: Date
  endTime?: Date
}

export const StepVisualization: Component<{ step: TaskStep }> = (props) => {
  const server = useServer()

  const formatJson = (obj: unknown): string => {
    try {
      return JSON.stringify(obj, null, 2)
    } catch {
      return String(obj)
    }
  }

  const formatDuration = (start?: Date, end?: Date): string => {
    if (!start) return ''
    const endTime = end || new Date()
    const duration = endTime.getTime() - start.getTime()
    if (duration < 1000) return `${duration}ms`
    return `${(duration / 1000).toFixed(1)}s`
  }

  return (
    <div class={styles.container}>
      {/* Step Header */}
      <div class={styles.header} classList={{
        [styles.completed]: props.step.status === 'completed',
        [styles.running]: props.step.status === 'running',
        [styles.failed]: props.step.status === 'failed',
        [styles.pending]: props.step.status === 'pending'
      }}>
        <div class={styles.statusIcon}>
          {props.step.status === 'completed' && '✓'}
          {props.step.status === 'running' && '🔄'}
          {props.step.status === 'failed' && '✗'}
          {props.step.status === 'pending' && '⏳'}
        </div>
        <div class={styles.headerContent}>
          <div class={styles.title}>{props.step.title}</div>
          <Show when={props.step.startTime}>
            <div class={styles.meta}>
              <span class={styles.time}>
                {props.step.startTime?.toLocaleTimeString()}
              </span>
              <Show when={props.step.endTime || props.step.status === 'running'}>
                <span class={styles.duration}>
                  {formatDuration(props.step.startTime, props.step.endTime)}
                </span>
              </Show>
            </div>
          </Show>
        </div>
      </div>

      {/* Tool Calls */}
      <Show when={props.step.toolCalls && props.step.toolCalls.length > 0}>
        <div class={styles.section}>
          <div class={styles.sectionTitle}>Tool Calls</div>
          <For each={props.step.toolCalls}>
            {(toolCall) => (
              <div class={styles.toolCall}>
                <div class={styles.toolCallHeader}>
                  <span class={styles.toolName}>{toolCall.name}</span>
                  <Show when={toolCall.startTime}>
                    <span class={styles.toolDuration}>
                      {formatDuration(toolCall.startTime, toolCall.endTime)}
                    </span>
                  </Show>
                </div>

                {/* Parameters */}
                <div class={styles.toolSection}>
                  <div class={styles.toolSectionTitle}>Parameters</div>
                  <pre class={styles.codeBlock}>
                    <code>{formatJson(toolCall.parameters)}</code>
                  </pre>
                </div>

                {/* Result or Error */}
                <Switch>
                  <Match when={toolCall.error}>
                    <div class={styles.toolSection}>
                      <div class={styles.toolSectionTitle}>Error</div>
                      <div class={styles.errorBlock}>{toolCall.error}</div>
                    </div>
                  </Match>
                  <Match when={toolCall.result !== undefined}>
                    <div class={styles.toolSection}>
                      <div class={styles.toolSectionTitle}>Result</div>
                      <pre class={styles.codeBlock}>
                        <code>{formatJson(toolCall.result)}</code>
                      </pre>
                    </div>
                  </Match>
                </Switch>
              </div>
            )}
          </For>
        </div>
      </Show>

      {/* File Changes */}
      <Show when={(props.step as StepDetail).fileChanges && (props.step as StepDetail).fileChanges!.length > 0}>
        <div class={styles.section}>
          <div class={styles.sectionTitle}>File Changes</div>
          <For each={(props.step as StepDetail).fileChanges}>
            {(change) => (
              <div class={styles.fileChange} classList={{
                [styles.create]: change.operation === 'create',
                [styles.update]: change.operation === 'update',
                [styles.delete]: change.operation === 'delete'
              }}>
                <div class={styles.fileChangeHeader}>
                  <span class={styles.fileOp}>
                    {change.operation === 'create' && '+'}
                    {change.operation === 'update' && '~'}
                    {change.operation === 'delete' && '-'}
                  </span>
                  <span class={styles.filePath}>{change.path}</span>
                </div>
                <Show when={change.diff}>
                  <pre class={styles.diffBlock}>
                    <code>{change.diff}</code>
                  </pre>
                </Show>
              </div>
            )}
          </For>
        </div>
      </Show>

      {/* Error Details */}
      <Show when={(props.step as StepDetail).stackTrace && props.step.status === 'failed'}>
        <div class={styles.section}>
          <div class={styles.sectionTitle}>Error Details</div>
          <pre class={styles.stackTrace}>
            <code>{(props.step as StepDetail).stackTrace}</code>
          </pre>
        </div>
      </Show>
    </div>
  )
}
