import { Component, createSignal, For, Show } from 'solid-js'
import { useServer } from '@opencode-ai/app/context/server'
import { TaskTimeline, type TaskStep } from '../components/TaskTimeline'
import { StepVisualization } from '../components/StepVisualization'
import { ToolCallMonitor } from '../components/ToolCallMonitor'
import styles from './TaskView.module.css'

/**
 * TaskView - Task Visualization Page
 *
 * Displays real-time task execution progress with timeline, step details, and tool call monitoring.
 * This is a central hub for visualizing AI agent task execution.
 *
 * TODO: Replace mock data with real SSE event integration (Task 8)
 */

const TaskView: Component = () => {
  const server = useServer()
  const [selectedStepId, setSelectedStepId] = createSignal<string | null>(null)

  // Mock data - will be replaced with real data in Task 8
  const mockSteps: TaskStep[] = [
    {
      id: '1',
      title: 'Analyze project structure',
      status: 'completed',
      startTime: new Date(Date.now() - 10000),
      endTime: new Date(Date.now() - 5000),
      toolCalls: [
        {
          id: '1-1',
          name: 'bash',
          parameters: { command: 'find . -type f -name "*.ts"' },
          result: { files: ['src/index.ts', 'src/app.tsx'] },
          startTime: new Date(Date.now() - 10000),
          endTime: new Date(Date.now() - 8000)
        }
      ]
    },
    {
      id: '2',
      title: 'Implement TaskView component',
      status: 'running',
      startTime: new Date(Date.now() - 4000),
      toolCalls: [
        {
          id: '2-1',
          name: 'write',
          parameters: { path: 'TaskView.tsx', content: 'export const TaskView = () => {}' },
          startTime: new Date(Date.now() - 3000)
        }
      ]
    },
    {
      id: '3',
      title: 'Add routing configuration',
      status: 'pending',
      toolCalls: []
    },
    {
      id: '4',
      title: 'Test and verify integration',
      status: 'pending',
      toolCalls: []
    }
  ]

  const [steps, setSteps] = createSignal<TaskStep[]>(mockSteps)

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
          Mock data is currently displayed. Real-time data integration coming in Task 8.
        </div>
      </div>
    </div>
  )
}

export default TaskView

