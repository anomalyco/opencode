import { useState, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

interface DevServerInfo {
  url: string
  port: number
  status: ProcessStatus
}

interface ProcessStatus {
  type: 'Starting' | 'Running' | 'Stopped' | 'Error'
  message?: string
}

interface LogEntry {
  timestamp: number
  level: 'info' | 'warn' | 'error'
  message: string
}

interface PreviewTabProps {
  workspaceId?: string
  rootPath?: string
}

export default function PreviewTab({ workspaceId, rootPath }: PreviewTabProps) {
  const [devServerInfo, setDevServerInfo] = useState<DevServerInfo | null>(null)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [showLogs, setShowLogs] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!workspaceId) return

    // Check existing dev server status
    checkDevServerStatus()

    // Listen to log events
    const unlistenPromise = listen<LogEntry>(`dev-log:${workspaceId}`, (event) => {
      setLogs((prev) => [...prev, event.payload])
    })

    return () => {
      unlistenPromise.then((unlisten) => unlisten())
    }
  }, [workspaceId])

  const checkDevServerStatus = async () => {
    if (!workspaceId) return

    try {
      const status = await invoke<DevServerInfo | null>('get_dev_server_status', {
        workspaceId,
      })
      if (status) {
        setDevServerInfo(status)
      }
    } catch (err) {
      console.error('Failed to check dev server status:', err)
    }
  }

  const startDevServer = async () => {
    if (!workspaceId || !rootPath) return

    setIsLoading(true)
    setError(null)

    try {
      // Request permission first
      const granted = await invoke<boolean>('request_dev_permission', {
        workspaceId,
        rootPath,
      })

      if (!granted) {
        setError('Permission denied to start dev server')
        setIsLoading(false)
        return
      }

      // Start dev server
      const info = await invoke<DevServerInfo>('workspace_dev_start', {
        workspaceId,
        rootPath,
      })

      setDevServerInfo(info)
      setLogs([])
    } catch (err: any) {
      setError(err?.toString() || 'Failed to start dev server')
    } finally {
      setIsLoading(false)
    }
  }

  const stopDevServer = async () => {
    if (!workspaceId) return

    setIsLoading(true)
    try {
      await invoke('workspace_dev_stop', { workspaceId })
      setDevServerInfo(null)
      setLogs([])
    } catch (err: any) {
      setError(err?.toString() || 'Failed to stop dev server')
    } finally {
      setIsLoading(false)
    }
  }

  const restartDevServer = async () => {
    await stopDevServer()
    await new Promise((resolve) => setTimeout(resolve, 1000))
    await startDevServer()
  }

  // No workspace selected
  if (!workspaceId || !rootPath) {
    return (
      <div className="flex items-center justify-center h-full bg-gray-800">
        <div className="text-center">
          <div className="text-gray-500 mb-4">
            <svg className="w-16 h-16 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
          </div>
          <p className="text-gray-400 text-sm">No workspace opened</p>
          <p className="text-gray-500 text-xs mt-1">Open a workspace to preview</p>
        </div>
      </div>
    )
  }

  // Dev server not running
  if (!devServerInfo || devServerInfo.status.type === 'Stopped') {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-gray-800 gap-4">
        <div className="text-center">
          <div className="text-gray-500 mb-4">
            <svg className="w-16 h-16 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
            </svg>
          </div>
          <p className="text-gray-400 text-sm mb-2">Dev server not running</p>
          <p className="text-gray-500 text-xs mb-4">Start the dev server to preview your app</p>
          <button
            onClick={startDevServer}
            disabled={isLoading}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? 'Starting...' : 'Start Dev Server'}
          </button>
          {error && <p className="text-red-400 text-xs mt-2 max-w-md">{error}</p>}
        </div>
      </div>
    )
  }

  // Dev server starting
  if (devServerInfo.status.type === 'Starting') {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-gray-800 gap-4">
        <div className="text-center">
          <div className="text-blue-500 mb-4 animate-spin">
            <svg className="w-16 h-16 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </div>
          <p className="text-gray-400 text-sm mb-2">Starting dev server...</p>
          <p className="text-gray-500 text-xs">Port: {devServerInfo.port}</p>
        </div>
      </div>
    )
  }

  // Dev server error
  if (devServerInfo.status.type === 'Error') {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-gray-800 gap-4">
        <div className="text-center max-w-md">
          <div className="text-red-500 mb-4">
            <svg className="w-16 h-16 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <p className="text-gray-400 text-sm mb-2">Dev server error</p>
          <p className="text-red-400 text-xs mb-4">{devServerInfo.status.message}</p>
          <button
            onClick={restartDevServer}
            disabled={isLoading}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors disabled:opacity-50"
          >
            {isLoading ? 'Restarting...' : 'Restart Server'}
          </button>
        </div>
      </div>
    )
  }

  // Dev server running - show iframe
  return (
    <div className="flex flex-col h-full bg-gray-900">
      {/* Status Bar */}
      <div className="flex items-center justify-between px-4 py-2 bg-gray-800 border-b border-gray-700">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
            <span className="text-sm text-gray-300">Running on port {devServerInfo.port}</span>
          </div>
          <a
            href={devServerInfo.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-400 hover:text-blue-300"
          >
            {devServerInfo.url}
          </a>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowLogs(!showLogs)}
            className="px-3 py-1 text-xs text-gray-300 bg-gray-700 rounded hover:bg-gray-600 transition-colors"
          >
            {showLogs ? 'Hide' : 'Show'} Logs ({logs.length})
          </button>
          <button
            onClick={restartDevServer}
            disabled={isLoading}
            className="px-3 py-1 text-xs text-gray-300 bg-gray-700 rounded hover:bg-gray-600 transition-colors disabled:opacity-50"
          >
            Restart
          </button>
          <button
            onClick={stopDevServer}
            disabled={isLoading}
            className="px-3 py-1 text-xs text-white bg-red-600 rounded hover:bg-red-700 transition-colors disabled:opacity-50"
          >
            Stop
          </button>
        </div>
      </div>

      {/* Logs Panel (optional) */}
      {showLogs && (
        <div className="h-48 overflow-y-auto bg-black p-2 border-b border-gray-700 font-mono text-xs">
          {logs.length === 0 ? (
            <p className="text-gray-500">No logs yet...</p>
          ) : (
            logs.map((log, idx) => (
              <div
                key={idx}
                className={`mb-1 ${
                  log.level === 'error'
                    ? 'text-red-400'
                    : log.level === 'warn'
                    ? 'text-yellow-400'
                    : 'text-gray-300'
                }`}
              >
                <span className="text-gray-500">[{new Date(log.timestamp).toLocaleTimeString()}]</span> {log.message}
              </div>
            ))
          )}
        </div>
      )}

      {/* Preview iframe */}
      <div className="flex-1 relative">
        <iframe
          src={devServerInfo.url}
          className="w-full h-full border-0"
          title="Preview"
          sandbox="allow-same-origin allow-scripts allow-forms allow-modals allow-popups"
        />
      </div>
    </div>
  )
}
