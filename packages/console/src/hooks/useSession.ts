import { useState, useEffect, useCallback, useRef } from 'react'
import { opencode, type Session, type Message } from '../lib'
import type { SelectedModel } from './useProviders'

export interface UseSessionOptions {
  onResponseComplete?: () => void
}

export function useSession(
  workspaceId?: string,
  rootPath?: string,
  selectedModel?: SelectedModel | null,
  options?: UseSessionOptions
) {
  const [session, setSession] = useState<Session | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isSending, setIsSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [serverStatus, setServerStatus] = useState<'checking' | 'running' | 'stopped'>('checking')
  const [isResponseComplete, setIsResponseComplete] = useState(false)
  
  // Track message parts for real-time updates
  const messagePartsRef = useRef<Map<string, Map<string, any>>>(new Map())
  const onResponseCompleteRef = useRef(options?.onResponseComplete)

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

  // Update ref when callback changes
  useEffect(() => {
    onResponseCompleteRef.current = options?.onResponseComplete
  }, [options?.onResponseComplete])

  // Connect to event stream for real-time updates
  useEffect(() => {
    if (serverStatus !== 'running' || !session) return

    // Connect to event stream
    opencode.connectEventStream((error) => {
      console.error('Event stream error:', error)
    })

    // Subscribe to message part updates
    const unsubPartUpdated = opencode.onEvent('message.part.updated', (event) => {
      const { part } = event.properties
      
      // Only handle parts for current session
      if (part.sessionID !== session.id) return

      // Reset response complete state when new parts arrive
      setIsResponseComplete(false)

      // Update message parts tracking
      if (!messagePartsRef.current.has(part.messageID)) {
        messagePartsRef.current.set(part.messageID, new Map())
      }
      messagePartsRef.current.get(part.messageID)!.set(part.id, part)

      // Update messages state
      setMessages(prevMessages => {
        // Find or create message
        const existingIndex = prevMessages.findIndex(m => m.id === part.messageID)
        
        if (existingIndex >= 0) {
          // Update existing message
          const updated = [...prevMessages]
          const msg = updated[existingIndex]
          const parts = messagePartsRef.current.get(part.messageID)
          
          if (parts) {
            updated[existingIndex] = {
              ...msg,
              parts: Array.from(parts.values()),
            }
          }
          
          return updated
        } else {
          // Create new message (assistant response)
          const newMessage: Message = {
            id: part.messageID,
            role: 'assistant',
            parts: [part],
            createdAt: new Date().toISOString(),
          }
          return [...prevMessages, newMessage]
        }
      })
    })

    // Subscribe to session idle event (response complete)
    const unsubSessionIdle = opencode.onEvent('session.idle', (event) => {
      // Only handle events for current session
      if (event.properties?.sessionID !== session.id) return

      setIsSending(false)
      setIsResponseComplete(true)
      
      // Call the callback
      onResponseCompleteRef.current?.()
    })

    return () => {
      unsubPartUpdated()
      unsubSessionIdle()
      // Don't disconnect event stream here - keep it connected for the session
    }
  }, [serverStatus, session])

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

        // Create new session with optional model selection
        const newSession = await opencode.createSession({
          agent: 'build',
          directory: rootPath,
          providerID: selectedModel?.providerID,
          modelID: selectedModel?.modelID,
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
        // Add user message immediately
        const userMessage: Message = {
          id: `user-${Date.now()}`,
          role: 'user',
          parts: [{ 
            id: `part-${Date.now()}`,
            sessionID: session.id,
            messageID: `user-${Date.now()}`,
            type: 'text', 
            text: content 
          }],
          createdAt: new Date().toISOString(),
        }
        setMessages((prev) => [...prev, userMessage])

        // Send message - response will come through event stream
        await opencode.sendMessage({
          sessionId: session.id,
          content,
        })
      } catch (err: any) {
        setError(err?.message || 'Failed to send message')
        setIsSending(false)
      }
      
      // Reset response complete state
      setIsResponseComplete(false)
      
      // Don't set isSending to false immediately - wait for session.idle event
      // Use a timeout as fallback in case event doesn't arrive
      setTimeout(() => setIsSending(false), 60000) // 60s fallback
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
      messagePartsRef.current.clear()
    } catch (err: any) {
      setError(err?.message || 'Failed to clear session')
    }
  }, [session, workspaceId])

  // Create new session (clear current and start fresh)
  const createNewSession = useCallback(async () => {
    if (!workspaceId || !rootPath || serverStatus !== 'running') return

    setIsLoading(true)
    setError(null)

    try {
      // Delete old session if exists
      if (session) {
        try {
          await opencode.deleteSession(session.id)
        } catch {
          // Ignore errors when deleting old session
        }
      }

      // Clear local state
      localStorage.removeItem(`session:${workspaceId}`)
      setMessages([])
      messagePartsRef.current.clear()

      // Create new session
      const newSession = await opencode.createSession({
        agent: 'build',
        directory: rootPath,
        providerID: selectedModel?.providerID,
        modelID: selectedModel?.modelID,
      })

      setSession(newSession)
      localStorage.setItem(`session:${workspaceId}`, newSession.id)
    } catch (err: any) {
      setError(err?.message || 'Failed to create new session')
    } finally {
      setIsLoading(false)
    }
  }, [workspaceId, rootPath, serverStatus, session, selectedModel])

  return {
    session,
    messages,
    isLoading,
    isSending,
    isResponseComplete,
    error,
    serverStatus,
    sendMessage,
    clearSession,
    createNewSession,
  }
}
