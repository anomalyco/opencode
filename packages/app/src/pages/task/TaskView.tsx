import { Component, createSignal, For, Show } from 'solid-js'
import { useServer } from '@/context/server'
import { TaskTimeline, type TaskStep } from '../../components/task/TaskTimeline'
import { StepVisualization } from '../../components/task/StepVisualization'
import { ToolCallMonitor } from '../../components/task/ToolCallMonitor'
import { useTaskProgress } from '../../hooks/task/useTaskProgress'
import styles from './TaskView.module.css'

/**
 * TaskView - Task Visualization Page
 *
 * Displays real-time task execution progress with timeline, step details, and tool call monitoring.
 * This is a central hub for visualizing AI agent task execution.
 *
 * Connects to OpenCode SSE events to display actual task progress.
 */

const TaskView: Component = () => {
  const server = useServer()
  const [selectedStepId, setSelectedStepId] = createSignal<string | null>(null)

  // Use the useTaskProgress hook to connect to SSE events
  const { steps, isConnected } = useTaskProgress()

  const selectedStep = () => {
    const id = selectedStepId()
    return steps().find(s => s.id === id)
  }

  const handleStepClick = (stepId: string) => {
    setSelectedStepId(stepId)
  }

  return (
    <div class={styles.container}>
      {/* Header */}
      <div class={styles.header}>
        <h1 class={styles.title}>Task Visualization</h1>
        <div class={styles.status}>
          <span class={styles.serverStatus}>
            Server: {server.url() ? 'Connected' : 'Disconnected'}
          </span>
          <span class={styles.serverStatus}>
            SSE: {isConnected() ? 'Active' : 'Connecting...'}
          </span>
        </div>
      </div>

      {/* Main Content */}
      <div class={styles.content}>
        {/* Left Panel: Task Timeline */}
        <div class={styles.timelinePanel}>
          <div class={styles.panelHeader}>
            <h2>Task Timeline</h2>
          </div>
          <div class={styles.panelContent}>
            <TaskTimeline steps={steps()} />
          </div>
        </div>

        {/* Center Panel: Step Visualization */}
        <div class={styles.detailsPanel}>
          <div class={styles.panelHeader}>
            <h2>Step Details</h2>
            <Show when={selectedStep()}>
              <span class={styles.stepInfo}>
                Step {selectedStepId()}
              </span>
            </Show>
          </div>
          <div class={styles.panelContent}>
            <Show
              when={selectedStep()}
              fallback={
                <div class={styles.empty}>
                  <div class={styles.emptyIcon}>📋</div>
                  <div class={styles.emptyText}>
                    Select a step from the timeline to view details
                  </div>
                </div>
              }
            >
              {(step) => <StepVisualization step={step()} />}
            </Show>
          </div>
        </div>

        {/* Right Panel: Tool Call Monitor */}
        <div class={styles.toolsPanel}>
          <div class={styles.panelHeader}>
            <h2>Tool Calls</h2>
          </div>
          <div class={styles.panelContent}>
            <ToolCallMonitor />
          </div>
        </div>
      </div>

      {/* Footer */}
      <div class={styles.footer}>
        <div class={styles.footerNote}>
          Connected to OpenCode SSE events. Real-time task progress visualization active.
        </div>
      </div>
    </div>
  )
}

export default TaskView

