import { useState, useRef, useEffect } from 'react'
import { useSession, type SelectedModel } from '../hooks'
import type { Message, MessagePart } from '../lib'

interface ChatPanelProps {
  workspaceId?: string
  rootPath?: string
  selectedModel?: SelectedModel | null
}

export default function ChatPanel({ workspaceId, rootPath, selectedModel }: ChatPanelProps) {
  const [input, setInput] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const {
    session,
    messages,
    isLoading,
    isSending,
    error,
    serverStatus,
    sendMessage,
  } = useSession(workspaceId, rootPath, selectedModel)

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSend = async () => {
    if (!input.trim() || isSending) return

    await sendMessage(input)
    setInput('')
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="flex flex-col h-full bg-gray-900">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-700 flex items-center justify-between">
        <h2 className="text-sm font-medium text-gray-300">Chat</h2>
        {serverStatus === 'stopped' && (
          <span className="text-xs text-yellow-400">⚠ OpenCode Server offline</span>
        )}
        {serverStatus === 'running' && session && (
          <span className="text-xs text-green-400">● Connected</span>
        )}
      </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="space-y-4">
          {/* Welcome Message */}
          {messages.length === 0 && (
            <div className="bg-gray-800 rounded-lg p-4">
              <p className="text-sm text-gray-300">
                👋 Welcome to Agent Foundry Build Studio!
              </p>
              <p className="text-sm text-gray-400 mt-2">
                {workspaceId
                  ? serverStatus === 'running'
                    ? 'Start by describing what you want to build...'
                    : 'Waiting for OpenCode Server to start...'
                  : 'Open a workspace to get started.'}
              </p>
            </div>
          )}

          {/* Loading State */}
          {isLoading && (
            <div className="text-center text-gray-500 text-sm">
              Initializing session...
            </div>
          )}

          {/* Error State */}
          {error && (
            <div className="bg-red-900/20 border border-red-700 rounded-lg p-3">
              <p className="text-sm text-red-400">{error}</p>
            </div>
          )}

          {/* Messages */}
          {messages.map((message) => (
            <MessageBubble key={message.id} message={message} />
          ))}

          {/* Sending Indicator */}
          {isSending && (
            <div className="flex items-center gap-2 text-gray-500 text-sm">
              <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
              <span>AI is thinking...</span>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input Area */}
      <div className="p-4 border-t border-gray-700">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            workspaceId
              ? serverStatus === 'running'
                ? 'Describe what you want to build... (Ctrl+Enter to send)'
                : 'OpenCode Server is offline...'
              : 'Open a workspace first...'
          }
          disabled={!workspaceId || serverStatus !== 'running' || isSending}
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
          rows={3}
        />
        <div className="flex justify-between items-center mt-2">
          <span className="text-xs text-gray-500">
            Tip: Press Ctrl+Enter to send
          </span>
          <button
            onClick={handleSend}
            disabled={
              !workspaceId ||
              serverStatus !== 'running' ||
              isSending ||
              !input.trim()
            }
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSending ? 'Sending...' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  )
}

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === 'user'

  // Improved filtering - less aggressive, allow most parts to show
  const visibleParts = message.parts.filter(part => {
    // Always filter out synthetic parts
    if (part.synthetic) return false
    
    // For text parts, only filter if completely empty
    if (part.type === 'text') {
      return !!part.text?.trim()
    }
    
    // For all other part types, show them by default
    // (tool, reasoning, step-start, step-finish, file, agent, etc.)
    return true
  })

  // Debug logging to help diagnose issues
  if (visibleParts.length === 0) {
    console.log('[ChatPanel] Message with no visible parts:', {
      messageId: message.id,
      role: message.role,
      totalParts: message.parts.length,
      parts: message.parts.map(p => ({ type: p.type, synthetic: p.synthetic, hasText: !!p.text }))
    })
  }

  // Don't render anything if no visible parts
  if (visibleParts.length === 0) {
    return null
  }

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[80%] rounded-lg p-3 ${
          isUser
            ? 'bg-blue-600 text-white'
            : 'bg-gray-800 text-gray-300 border border-gray-700'
        }`}
      >
        {visibleParts.map((part, idx) => (
          <MessagePartRenderer key={part.id || idx} part={part} isUser={isUser} />
        ))}
      </div>
    </div>
  )
}

function MessagePartRenderer({
  part,
  isUser,
}: {
  part: MessagePart
  isUser: boolean
}) {
  switch (part.type) {
    case 'text':
      if (!part.text?.trim()) return null
      return (
        <p className="text-sm whitespace-pre-wrap">{part.text}</p>
      )

    case 'reasoning':
      return (
        <div className="text-xs text-gray-500 italic mt-1 border-l-2 border-gray-600 pl-2">
          💭 {part.text}
        </div>
      )

    case 'tool':
      return (
        <div className={`text-xs ${isUser ? 'text-blue-200' : 'text-gray-400'} mt-2`}>
          <div className="flex items-center gap-2">
            <span className="font-mono bg-gray-900/50 px-2 py-1 rounded">
              🔧 {part.tool}
            </span>
            {part.state && (
              <span className={`px-1.5 py-0.5 rounded text-xs ${
                part.state.status === 'completed' 
                  ? 'bg-green-600/30 text-green-400' 
                  : part.state.status === 'error'
                  ? 'bg-red-600/30 text-red-400'
                  : 'bg-yellow-600/30 text-yellow-400'
              }`}>
                {part.state.status}
              </span>
            )}
          </div>
          {part.state?.output && (
            <pre className="font-mono bg-gray-900/50 p-2 rounded overflow-x-auto max-h-32 mt-1 text-xs">
              {typeof part.state.output === 'string'
                ? part.state.output
                : JSON.stringify(part.state.output, null, 2)}
            </pre>
          )}
          {part.state?.error && (
            <div className="text-red-400 mt-1">
              Error: {part.state.error.message || String(part.state.error)}
            </div>
          )}
        </div>
      )

    case 'step-start':
      return (
        <div className="text-xs text-blue-400 mt-2 flex items-center gap-2">
          <span>▶</span>
          <span>{part.title || part.step}</span>
        </div>
      )

    case 'step-finish':
      return (
        <div className="text-xs text-green-400 mt-1 flex items-center gap-2">
          <span>✓</span>
          <span>{part.title || part.step} completed</span>
        </div>
      )

    case 'file':
      return (
        <div className={`text-xs ${isUser ? 'text-blue-200' : 'text-gray-400'} mt-2`}>
          <span className="font-mono bg-gray-900/50 px-2 py-1 rounded">
            📄 {part.filename || 'Attached file'}
          </span>
        </div>
      )

    case 'agent':
      return (
        <div className="text-xs text-purple-400 mt-2 flex items-center gap-2">
          <span>🤖</span>
          <span>Agent: {part.title || 'Processing...'}</span>
        </div>
      )

    case 'snapshot':
    case 'patch':
    case 'compaction':
    case 'retry':
    case 'subtask':
      // These are internal/system parts, don't display
      return null

    default:
      // Fallback for unknown part types - show with debug info
      console.log('[ChatPanel] Unknown part type:', part.type, part)
      
      // If it has text, display it
      if (part.text?.trim()) {
        return (
          <div className="text-sm whitespace-pre-wrap">
            <div className="text-xs text-gray-500 mb-1">[{part.type}]</div>
            {part.text}
          </div>
        )
      }
      
      // Otherwise show a generic indicator
      return (
        <div className="text-xs text-gray-500 italic mt-1">
          [{part.type}]
        </div>
      )
  }
}
