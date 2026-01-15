import { useState, useEffect, useCallback } from 'react'
import { opencode, Session, Message, MessagePart } from '../lib/opencode-client'

export function useSession(workspaceId?: string, rootPath?: string) {
  const [session, setSession] = useState<Session | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isSending, setIsSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [serverStatus, setServerStatus] = useState<'checking' | 'running' | 'stopped'>('checking')

  // Check OpenCode Server status
  useEffect(() => {
    const checkServer = async () => {
      const isRunning = await opencode.healthCheck()
      setServerStatus(isRunning ? 'running' : 'stopped')
    }

    checkServer()
    const interval = setInterval(checkServer, 5000) // Check every 5s

    return () => clearInterval(interval)
  }, [])

  // Create or restore session when workspace changes
  useEffect(() => {
    if (!workspaceId || !rootPath || serverStatus !== 'running') {
      return
    }

    const initSession = async () => {
      setIsLoading(true)
      setError(null)

      try {
        // Try to restore session from localStorage
        const savedSessionId = localStorage.getItem(`session:${workspaceId}`)

        if (savedSessionId) {
          try {
            const existingSession = await opencode.getSession(savedSessionId)
            setSession(existingSession)

            // Load message history
            const history = await opencode.getMessages(savedSessionId)
            setMessages(history)
            return
          } catch {
            // Session doesn't exist, create new one
            localStorage.removeItem(`session:${workspaceId}`)
          }
        }

        // Create new session
        const newSession = await opencode.createSession({
          agent: 'build',
          directory: rootPath,
        })

        setSession(newSession)
        localStorage.setItem(`session:${workspaceId}`, newSession.id)
      } catch (err: any) {
        setError(err?.message || 'Failed to initialize session')
      } finally {
        setIsLoading(false)
      }
    }

    initSession()
  }, [workspaceId, rootPath, serverStatus])

  // Send message
  const sendMessage = useCallback(
    async (content: string) => {
      if (!session || isSending) return

      setIsSending(true)
      setError(null)

      try {
        // Add user message
        const userMessage: Message = {
          id: `user-${Date.now()}`,
          role: 'user',
          parts: [{ type: 'text', text: content }],
          createdAt: new Date().toISOString(),
        }
        setMessages((prev) => [...prev, userMessage])

        // Create assistant message placeholder
        const assistantMessage: Message = {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          parts: [],
          createdAt: new Date().toISOString(),
        }
        setMessages((prev) => [...prev, assistantMessage])

        // Stream response
        await opencode.sendMessage(
          {
            sessionId: session.id,
            content,
          },
          (part: MessagePart) => {
            setMessages((prev) => {
              const updated = [...prev]
              const lastMessage = updated[updated.length - 1]
              if (lastMessage.role === 'assistant') {
                lastMessage.parts.push(part)
              }
              return updated
            })
          }
        )
      } catch (err: any) {
        setError(err?.message || 'Failed to send message')
      } finally {
        setIsSending(false)
      }
    },
    [session, isSending]
  )

  // Clear session
  const clearSession = useCallback(async () => {
    if (!session || !workspaceId) return

    try {
      await opencode.deleteSession(session.id)
      localStorage.removeItem(`session:${workspaceId}`)
      setSession(null)
      setMessages([])
    } catch (err: any) {
      setError(err?.message || 'Failed to clear session')
    }
  }, [session, workspaceId])

  return {
    session,
    messages,
    isLoading,
    isSending,
    error,
    serverStatus,
    sendMessage,
    clearSession,
  }
}
