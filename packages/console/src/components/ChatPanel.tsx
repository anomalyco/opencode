import { useState } from 'react'
import { useSession } from '../hooks/useSession'
import type { Message, MessagePart } from '../lib/opencode-client'

interface ChatPanelProps {
  workspaceId?: string
  rootPath?: string
}

export default function ChatPanel({ workspaceId, rootPath }: ChatPanelProps) {
  const [input, setInput] = useState('')
  const {
    session,
    messages,
    isLoading,
    isSending,
    error,
    serverStatus,
    sendMessage,
  } = useSession(workspaceId, rootPath)

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

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[80%] rounded-lg p-3 ${
          isUser
            ? 'bg-blue-600 text-white'
            : 'bg-gray-800 text-gray-300 border border-gray-700'
        }`}
      >
        {message.parts.map((part, idx) => (
          <MessagePartRenderer key={idx} part={part} isUser={isUser} />
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
      return (
        <p className="text-sm whitespace-pre-wrap">{part.text || part.content}</p>
      )

    case 'tool_use':
      return (
        <div className={`text-xs ${isUser ? 'text-blue-200' : 'text-gray-400'} mt-2`}>
          <span className="font-mono bg-gray-900/50 px-1 rounded">
            🔧 {part.tool_name}
          </span>
        </div>
      )

    case 'tool_result':
      return (
        <div className={`text-xs ${isUser ? 'text-blue-200' : 'text-gray-400'} mt-1`}>
          <pre className="font-mono bg-gray-900/50 p-2 rounded overflow-x-auto max-h-32">
            {typeof part.tool_result === 'string'
              ? part.tool_result
              : JSON.stringify(part.tool_result, null, 2)}
          </pre>
        </div>
      )

    case 'thinking':
      return (
        <div className="text-xs text-gray-500 italic mt-1">
          💭 {part.content}
        </div>
      )

    default:
      return null
  }
}
