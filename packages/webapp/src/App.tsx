import { Show, onMount } from "solid-js"
import { SessionList } from "./components/SessionList"
import { MessageView } from "./components/MessageView"
import { ChatInput } from "./components/ChatInput"
import {
  initializeStore,
  isConnected,
  isConnecting,
  currentSessionID,
  connectWebSocket,
  disconnectWebSocket,
} from "./stores/session"

export default function App() {
  onMount(() => {
    initializeStore()
  })

  return (
    <div class="flex flex-col h-screen bg-gray-950">
      {/* Header */}
      <header class="flex items-center justify-between px-6 py-4 border-b border-gray-800 bg-gray-900">
        <div class="flex items-center gap-3">
          <div class="w-8 h-8 bg-primary-600 rounded-lg flex items-center justify-center">
            <svg
              class="w-5 h-5 text-white"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"
              />
            </svg>
          </div>
          <div>
            <h1 class="text-xl font-bold text-gray-100">OpenCode</h1>
            <p class="text-xs text-gray-500">AI Coding Assistant</p>
          </div>
        </div>

        {/* Connection Status */}
        <div class="flex items-center gap-3">
          <Show when={isConnecting()}>
            <div class="flex items-center gap-2 text-yellow-400 text-sm">
              <div class="w-2 h-2 bg-yellow-400 rounded-full animate-pulse" />
              <span>Connecting...</span>
            </div>
          </Show>

          <Show when={isConnected() && !isConnecting()}>
            <div class="flex items-center gap-2 text-green-400 text-sm">
              <div class="w-2 h-2 bg-green-400 rounded-full" />
              <span>Connected</span>
            </div>
          </Show>

          <Show when={!isConnected() && !isConnecting()}>
            <div class="flex items-center gap-2 text-red-400 text-sm">
              <div class="w-2 h-2 bg-red-400 rounded-full" />
              <span>Disconnected</span>
              <button
                onClick={() => connectWebSocket()}
                class="ml-2 px-2 py-1 bg-red-600 hover:bg-red-700 rounded text-xs text-white"
              >
                Reconnect
              </button>
            </div>
          </Show>
        </div>
      </header>

      {/* Main Content */}
      <div class="flex-1 flex overflow-hidden">
        {/* Sidebar - Session List */}
        <aside class="w-80 flex-shrink-0">
          <SessionList />
        </aside>

        {/* Main Chat Area */}
        <main class="flex-1 flex flex-col bg-gray-950">
          <Show
            when={currentSessionID()}
            fallback={
              <div class="flex-1 flex items-center justify-center text-gray-500">
                <div class="text-center">
                  <svg
                    class="w-24 h-24 mx-auto mb-6 opacity-20"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"
                    />
                  </svg>
                  <h2 class="text-2xl font-semibold text-gray-400 mb-2">Welcome to OpenCode</h2>
                  <p class="text-gray-600">
                    Select a session from the sidebar or create a new one to get started
                  </p>
                </div>
              </div>
            }
          >
            {/* Messages */}
            <MessageView />

            {/* Input */}
            <ChatInput />
          </Show>
        </main>
      </div>

      {/* Footer */}
      <footer class="px-6 py-2 border-t border-gray-800 bg-gray-900 text-xs text-gray-600 text-center">
        <p>
          OpenCode WebApp •{" "}
          <a
            href="https://github.com/opencode"
            target="_blank"
            class="text-primary-400 hover:text-primary-300"
          >
            GitHub
          </a>
          {" • "}
          <a
            href="/api/doc"
            target="_blank"
            class="text-primary-400 hover:text-primary-300"
          >
            API Docs
          </a>
        </p>
      </footer>
    </div>
  )
}
