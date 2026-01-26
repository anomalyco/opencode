import { createSignal, onCleanup } from 'solid-js'
import { useSDK } from '@opencode-ai/app/context/sdk'
import type { Event, Message, AssistantMessage } from '@opencode-ai/sdk/v2/gen/types'
import type { TaskStep } from '../components/TaskTimeline'

/**
 * useTaskProgress - Hook for connecting to OpenCode SSE events
 *
 * Listens to OpenCode's `/event` SSE endpoint and tracks task progress:
 * - message.updated events - adds new messages as steps
 * - session.status events - tracks session status
 *
 * This hook converts OpenCode events into TaskStep format for visualization.
 */
export function useTaskProgress() {
  const sdk = useSDK()
  const [steps, setSteps] = createSignal<TaskStep[]>([])
  const [isConnected, setIsConnected] = createSignal(false)

  // Map messages to task steps
  const messageToStep = (message: Message): TaskStep => {
    if (message.role === 'assistant') {
      const assistantMsg = message as AssistantMessage
      const toolCalls = assistantMsg.parts
        .filter(part => part.type === 'tool_call')
        .map(toolCall => ({
          id: toolCall.id,
          name: toolCall.name,
          parameters: toolCall.arguments as Record<string, unknown>,
          result: toolCall.result,
          error: toolCall.error
        }))

      return {
        id: message.id,
        title: message.content?.text?.substring(0, 100) || 'Assistant Message',
        status: message.status === 'success' ? 'completed' :
                message.status === 'in_progress' ? 'running' :
                message.status === 'failed' ? 'failed' : 'pending',
        startTime: message.time?.start ? new Date(message.time.start) : undefined,
        endTime: message.time?.end ? new Date(message.time.end) : undefined,
        toolCalls
      }
    }

    // For user messages, create a simple step
    return {
      id: message.id,
      title: `User: ${message.content?.text?.substring(0, 100) || 'Message'}`,
      status: 'completed',
      startTime: message.time?.start ? new Date(message.time.start) : undefined
    }
  }

  // Subscribe to message updates
  const unsubscribe = sdk.event.on('message.updated', (event: Event & { type: 'message.updated' }) => {
    const message = event.properties.info

    setSteps(prevSteps => {
      // Check if step already exists
      const existingIndex = prevSteps.findIndex(s => s.id === message.id)

      if (existingIndex !== -1) {
        // Update existing step
        const updatedSteps = [...prevSteps]
        updatedSteps[existingIndex] = messageToStep(message)
        return updatedSteps
      } else {
        // Add new step
        return [...prevSteps, messageToStep(message)]
      }
    })
  })

  // Subscribe to session status
  const unsubscribeStatus = sdk.event.on('session.status', (event: Event & { type: 'session.status' }) => {
    setIsConnected(event.properties.status === 'ready')
  })

  onCleanup(() => {
    unsubscribe()
    unsubscribeStatus()
  })

  return {
    steps,
    isConnected
  }
}
