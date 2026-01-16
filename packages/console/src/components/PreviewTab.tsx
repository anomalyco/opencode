import { useState, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { LintResultPanel } from './'
import type { LintResult } from '../hooks'

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

interface InstallProgress {
  status: 'pending' | 'installing' | 'completed' | 'error'
  package_manager: string
  message: string
}

interface PreviewTabProps {
  workspaceId?: string
  rootPath?: string
  lintResult?: LintResult | null
  isLintChecking?: boolean
  onFixLintErrors?: () => void
}

type ViewportType = 'desktop' | 'iphone-se' | 'iphone-14-pro'

interface ViewportConfig {
  name: string
  width: number
  height: number
  icon: string
}

const VIEWPORTS: Record<ViewportType, ViewportConfig> = {
  'desktop': { name: 'Desktop', width: 0, height: 0, icon: '🖥️' }, // 0 means full width
  'iphone-se': { name: 'iPhone SE', width: 375, height: 667, icon: '📱' },
  'iphone-14-pro': { name: 'iPhone 14 Pro', width: 390, height: 844, icon: '📱' },
}

export default function PreviewTab({ 
  workspaceId, 
  rootPath,
  lintResult,
  isLintChecking,
  onFixLintErrors,
}: PreviewTabProps) {
  const [devServerInfo, setDevServerInfo] = useState<DevServerInfo | null>(null)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [showLogs, setShowLogs] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [viewport, setViewport] = useState<ViewportType>('desktop')
  const [installProgress, setInstallProgress] = useState<InstallProgress | null>(null)
  const [depsInstalled, setDepsInstalled] = useState<boolean | null>(null)

  useEffect(() => {
    if (!workspaceId || !rootPath) return

    // Check existing dev server status
    checkDevServerStatus()

    // Check if dependencies are installed
    checkDepsInstalled()

    // Listen to log events
    const unlistenLogPromise = listen<LogEntry>(`dev-log:${workspaceId}`, (event) => {
      setLogs((prev) => [...prev, event.payload])
      // Auto-show logs when an error is detected
      if (event.payload.level === 'error') {
        setShowLogs(true)
      }
    })

    // Listen to install progress events
    const unlistenInstallPromise = listen<InstallProgress>(`install-progress:${workspaceId}`, (event) => {
      setInstallProgress(event.payload)
      if (event.payload.status === 'completed') {
        setDepsInstalled(true)
      }
    })

    // Listen to dev server status change events
    const unlistenStatusPromise = listen<DevServerInfo>(`dev-status:${workspaceId}`, (event) => {
      setDevServerInfo(event.payload)
    })

    // Poll for status updates as a fallback (every 2 seconds while in Starting state)
    const pollInterval = setInterval(() => {
      checkDevServerStatus()
    }, 2000)

    return () => {
      unlistenLogPromise.then((unlisten) => unlisten())
      unlistenInstallPromise.then((unlisten) => unlisten())
      unlistenStatusPromise.then((unlisten) => unlisten())
      clearInterval(pollInterval)
    }
  }, [workspaceId, rootPath])

  const checkDepsInstalled = async () => {
    if (!rootPath) return
    try {
      const installed = await invoke<boolean>('check_deps_installed', { rootPath })
      setDepsInstalled(installed)
    } catch (err) {
      console.error('Failed to check deps:', err)
      setDepsInstalled(null)
    }
  }

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

  const installDeps = async () => {
    if (!workspaceId || !rootPath) return

    setIsLoading(true)
    setError(null)
    setInstallProgress({
      status: 'installing',
      package_manager: '',
      message: 'Detecting package manager...',
    })

    try {
      const result = await invoke<InstallProgress>('workspace_install_deps', {
        workspaceId,
        rootPath,
      })
      setInstallProgress(result)
      setDepsInstalled(true)
    } catch (err: any) {
      setError(err?.toString() || 'Failed to install dependencies')
      setInstallProgress({
        status: 'error',
        package_manager: '',
        message: err?.toString() || 'Failed to install dependencies',
      })
    } finally {
      setIsLoading(false)
    }
  }

  // Start preview: install deps and then start dev server
  const startPreview = async () => {
    if (!workspaceId || !rootPath) return
    
    setIsLoading(true)
    setError(null)
    
    try {
      // First, install dependencies if not installed
      if (!depsInstalled) {
        setInstallProgress({
          status: 'installing',
          package_manager: '',
          message: 'Installing dependencies...',
        })
        
        const installResult = await invoke<InstallProgress>('workspace_install_deps', {
          workspaceId,
          rootPath,
        })
        setInstallProgress(installResult)
        setDepsInstalled(true)
      }
      
      // Then start the dev server
      const granted = await invoke<boolean>('request_dev_permission', {
        workspaceId,
        rootPath,
      })

      if (!granted) {
        setError('Permission denied to start dev server')
        setIsLoading(false)
        return
      }

      const info = await invoke<DevServerInfo>('workspace_dev_start', {
        workspaceId,
        rootPath,
      })

      setDevServerInfo(info)
      setLogs([])
    } catch (err: any) {
      setError(err?.toString() || 'Failed to start preview')
    } finally {
      setIsLoading(false)
      setInstallProgress(null)
    }
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

  // Show lint result panel if lint check is in progress or has results
  // Only show if dev server is not running
  if ((isLintChecking || lintResult) && (!devServerInfo || devServerInfo.status.type === 'Stopped')) {
    return (
      <LintResultPanel
        lintResult={lintResult ?? null}
        isChecking={isLintChecking ?? false}
        onFixErrors={onFixLintErrors}
        onStartPreview={startPreview}
      />
    )
  }

  // Installing dependencies
  if (installProgress?.status === 'installing') {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-gray-800 gap-4">
        <div className="text-center">
          <div className="text-blue-500 mb-4 animate-spin">
            <svg className="w-16 h-16 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </div>
          <p className="text-gray-400 text-sm mb-2">Installing dependencies...</p>
          {installProgress.package_manager && (
            <p className="text-blue-400 text-xs mb-2">
              Using {installProgress.package_manager}
            </p>
          )}
          <p className="text-gray-500 text-xs">{installProgress.message}</p>
        </div>
      </div>
    )
  }

  // Dependencies not installed
  if (depsInstalled === false && (!devServerInfo || devServerInfo.status.type === 'Stopped')) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-gray-800 gap-4">
        <div className="text-center">
          <div className="text-yellow-500 mb-4">
            <svg className="w-16 h-16 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
            </svg>
          </div>
          <p className="text-gray-400 text-sm mb-2">Dependencies not installed</p>
          <p className="text-gray-500 text-xs mb-4">Install dependencies to start the dev server</p>
          <div className="flex gap-2 justify-center">
            <button
              onClick={installDeps}
              disabled={isLoading}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? 'Installing...' : 'Install Dependencies'}
            </button>
            <button
              onClick={startDevServer}
              disabled={isLoading}
              className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Start Anyway
            </button>
          </div>
          {error && <p className="text-red-400 text-xs mt-2 max-w-md">{error}</p>}
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
    const errorLogs = logs.filter((log) => log.level === 'error')
    const hasErrors = errorLogs.length > 0
    
    return (
      <div className="flex flex-col h-full bg-gray-800">
        {/* Main content */}
        <div className="flex-1 flex flex-col items-center justify-center gap-4">
          <div className="text-center">
            <div className="text-blue-500 mb-4 animate-spin">
              <svg className="w-16 h-16 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </div>
            <p className="text-gray-400 text-sm mb-2">Starting dev server...</p>
            <p className="text-gray-500 text-xs">Port: {devServerInfo.port}</p>
            {hasErrors && (
              <p className="text-yellow-400 text-xs mt-2">
                {errorLogs.length} error(s) detected - check logs below
              </p>
            )}
            <button
              onClick={stopDevServer}
              disabled={isLoading}
              className="mt-4 px-3 py-1 text-xs text-white bg-red-600 rounded hover:bg-red-700 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
        
        {/* Show logs during starting state if there are any */}
        {logs.length > 0 && (
          <div className="h-48 overflow-y-auto bg-black p-2 border-t border-gray-700 font-mono text-xs">
            <div className="flex items-center justify-between mb-2">
              <span className="text-gray-400">Server Logs ({logs.length})</span>
              {hasErrors && (
                <span className="text-red-400 text-xs">{errorLogs.length} error(s)</span>
              )}
            </div>
            {logs.map((log, idx) => (
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
            ))}
          </div>
        )}
      </div>
    )
  }

  // Dev server error
  if (devServerInfo.status.type === 'Error') {
    return (
      <div className="flex flex-col h-full bg-gray-800">
        {/* Error header */}
        <div className="flex-shrink-0 p-4 text-center border-b border-gray-700">
          <div className="text-red-500 mb-4">
            <svg className="w-12 h-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <p className="text-gray-400 text-sm mb-2">Dev server error</p>
          <div className="flex gap-2 justify-center">
            <button
              onClick={restartDevServer}
              disabled={isLoading}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              {isLoading ? 'Restarting...' : 'Restart Server'}
            </button>
            <button
              onClick={() => {
                setDevServerInfo(null)
                setLogs([])
              }}
              className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 transition-colors"
            >
              Dismiss
            </button>
          </div>
        </div>
        
        {/* Error details - scrollable */}
        <div className="flex-1 overflow-y-auto bg-black p-4 font-mono text-xs">
          <div className="text-gray-400 mb-2">Error Output:</div>
          <pre className="text-red-400 whitespace-pre-wrap break-words">
            {devServerInfo.status.message}
          </pre>
          
          {logs.length > 0 && (
            <>
              <div className="text-gray-400 mt-4 mb-2 border-t border-gray-700 pt-4">
                Full Logs ({logs.length} entries):
              </div>
              {logs.map((log, idx) => (
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
              ))}
            </>
          )}
        </div>
      </div>
    )
  }

  const currentViewport = VIEWPORTS[viewport]
  const isMobile = viewport !== 'desktop'
  const errorLogs = logs.filter((log) => log.level === 'error')
  const hasRuntimeErrors = errorLogs.length > 0

  // Dev server running - show iframe
  return (
    <div className="flex flex-col h-full bg-gray-900">
      {/* Status Bar */}
      <div className="flex items-center justify-between px-4 py-2 bg-gray-800 border-b border-gray-700">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full animate-pulse ${hasRuntimeErrors ? 'bg-yellow-500' : 'bg-green-500'}`}></div>
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
          {hasRuntimeErrors && (
            <span className="text-xs text-yellow-400 bg-yellow-900/30 px-2 py-0.5 rounded">
              {errorLogs.length} error(s) - check logs
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Viewport Selector */}
          <div className="flex items-center bg-gray-700 rounded overflow-hidden">
            {(Object.keys(VIEWPORTS) as ViewportType[]).map((key) => {
              const config = VIEWPORTS[key]
              const isActive = viewport === key
              return (
                <button
                  key={key}
                  onClick={() => setViewport(key)}
                  className={`px-2 py-1 text-xs transition-colors ${
                    isActive
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-300 hover:bg-gray-600'
                  }`}
                  title={config.width > 0 ? `${config.name} (${config.width}×${config.height})` : config.name}
                >
                  {config.icon} {key === 'desktop' ? 'Desktop' : config.width}
                </button>
              )
            })}
          </div>

          <div className="w-px h-5 bg-gray-600" />

          <button
            onClick={() => setShowLogs(!showLogs)}
            className={`px-3 py-1 text-xs rounded transition-colors ${
              hasRuntimeErrors 
                ? 'text-yellow-300 bg-yellow-900/50 hover:bg-yellow-800/50' 
                : 'text-gray-300 bg-gray-700 hover:bg-gray-600'
            }`}
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
      <div className="flex-1 relative overflow-auto bg-gray-950">
        {isMobile ? (
          // Mobile viewport with device frame
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <div
              className="relative bg-gray-800 rounded-[40px] p-3 shadow-2xl"
              style={{ width: currentViewport.width + 24, height: currentViewport.height + 24 }}
            >
              {/* Device notch */}
              <div className="absolute top-0 left-1/2 transform -translate-x-1/2 w-24 h-6 bg-gray-800 rounded-b-xl z-10" />
              
              {/* Screen */}
              <div
                className="relative bg-white rounded-[32px] overflow-hidden"
                style={{ width: currentViewport.width, height: currentViewport.height }}
              >
                <iframe
                  src={devServerInfo.url}
                  className="w-full h-full border-0"
                  title="Preview"
                />
              </div>

              {/* Home indicator */}
              <div className="absolute bottom-2 left-1/2 transform -translate-x-1/2 w-32 h-1 bg-gray-600 rounded-full" />
            </div>
          </div>
        ) : (
          // Desktop viewport (full width)
          <iframe
            src={devServerInfo.url}
            className="w-full h-full border-0"
            title="Preview"
          />
        )}
      </div>
    </div>
  )
}
