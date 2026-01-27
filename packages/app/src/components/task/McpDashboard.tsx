import { Component, For, Show, createResource } from 'solid-js'
import { useServer } from '@/context/server'
import styles from './McpDashboard.module.css'

export interface McpServerStatus {
  name: string
  status: 'connected' | 'disabled' | 'failed' | 'needs_auth' | 'needs_client_registration'
  error?: string
  toolCount?: number
}

const fetchMcpStatus = async (serverUrl: string): Promise<McpServerStatus[]> => {
  try {
    const mcpUrl = `${serverUrl}/mcp`
    const response = await fetch(mcpUrl)
    if (!response.ok) {
      // Return empty array on 404 or other errors
      console.warn(`MCP endpoint returned ${response.status}: ${response.statusText}`)
      return []
    }

    const contentType = response.headers.get('content-type')
    if (!contentType || !contentType.includes('application/json')) {
      console.warn('MCP endpoint did not return JSON')
      return []
    }

    const data: Record<string, { status: string; error?: string }> = await response.json()

    // Fetch tools count for connected servers
    const servers: McpServerStatus[] = await Promise.all(
      Object.entries(data).map(async ([name, info]) => {
        let toolCount: number | undefined = undefined

        // Only fetch tool count for connected servers
        if (info.status === 'connected') {
          try {
            const toolsResponse = await fetch(`${serverUrl}/mcp/tools`)
            if (toolsResponse.ok) {
              const toolsData: Record<string, unknown> = await toolsResponse.json()
              // Count tools that belong to this server
              // Tools are keyed by "server_name/tool_name"
              toolCount = Object.keys(toolsData).filter((key) =>
                key.startsWith(`${name}/`)
              ).length
            }
          } catch (error) {
            console.error(`Failed to fetch tools for ${name}:`, error)
          }
        }

        return {
          name,
          status: info.status as McpServerStatus['status'],
          error: info.error,
          toolCount,
        }
      })
    )

    return servers
  } catch (error) {
    console.error('Failed to fetch MCP status:', error)
    // Return empty array on any error
    return []
  }
}

export const McpDashboard: Component = () => {
  const server = useServer()
  const [status] = createResource(async () => {
    if (!server.url) return []
    return fetchMcpStatus(server.url)
  }, {
    initialValue: [],
  })

  const handleConnect = async (name: string) => {
    if (!server.url) return
    try {
      const response = await fetch(`${server.url}/mcp/${name}/connect`, { method: 'POST' })
      if (response.ok) {
        status.refetch()
      }
    } catch (error) {
      console.error(`Failed to connect ${name}:`, error)
    }
  }

  const handleDisconnect = async (name: string) => {
    if (!server.url) return
    try {
      const response = await fetch(`${server.url}/mcp/${name}/disconnect`, { method: 'POST' })
      if (response.ok) {
        status.refetch()
      }
    } catch (error) {
      console.error(`Failed to disconnect ${name}:`, error)
    }
  }

  const handleAuthenticate = async (name: string) => {
    if (!server.url) return
    try {
      const response = await fetch(`${server.url}/mcp/${name}/auth/authenticate`, { method: 'POST' })
      if (response.ok) {
        status.refetch()
      }
    } catch (error) {
      console.error(`Failed to authenticate ${name}:`, error)
    }
  }

  const getStatusIcon = (status: McpServerStatus['status']): string => {
    switch (status) {
      case 'connected':
        return '●'
      case 'disabled':
        return '○'
      case 'failed':
        return '✗'
      case 'needs_auth':
        return '🔒'
      case 'needs_client_registration':
        return '⚠'
      default:
        return '?'
    }
  }

  const getStatusText = (status: McpServerStatus['status']): string => {
    switch (status) {
      case 'connected':
        return 'Connected'
      case 'disabled':
        return 'Disabled'
      case 'failed':
        return 'Failed'
      case 'needs_auth':
        return 'Needs Authentication'
      case 'needs_client_registration':
        return 'Needs Registration'
      default:
        return 'Unknown'
    }
  }

  return (
    <div class={styles.dashboard}>
      <div class={styles.header}>
        <h2 class={styles.title}>MCP Servers</h2>
        <Show when={status.loading}>
          <span class={styles.loadingText}>Loading...</span>
        </Show>
      </div>

      <Show
        when={status().length > 0}
        fallback={
          <div class={styles.emptyState}>
            <p class={styles.emptyText}>No MCP servers configured</p>
          </div>
        }
      >
        <div class={styles.serverList}>
          <For each={status()}>
            {(serverInfo) => (
              <div
                class={styles.serverCard}
                classList={{
                  [styles.connected]: serverInfo.status === 'connected',
                  [styles.disabled]: serverInfo.status === 'disabled',
                  [styles.failed]: serverInfo.status === 'failed',
                  [styles.needsAuth]: serverInfo.status === 'needs_auth',
                  [styles.needsRegistration]:
                    serverInfo.status === 'needs_client_registration',
                }}
              >
                <div class={styles.serverHeader}>
                  <div class={styles.serverInfo}>
                    <span class={styles.statusIcon}>{getStatusIcon(serverInfo.status)}</span>
                    <span class={styles.serverName}>{serverInfo.name}</span>
                  </div>
                  <span class={styles.statusText}>{getStatusText(serverInfo.status)}</span>
                </div>

                <Show when={serverInfo.error}>
                  <div class={styles.errorMessage}>{serverInfo.error}</div>
                </Show>

                <div class={styles.serverDetails}>
                  <Show when={serverInfo.toolCount !== undefined}>
                    <div class={styles.toolCount}>
                      <span class={styles.toolCountLabel}>Tools:</span>
                      <span class={styles.toolCountValue}>{serverInfo.toolCount}</span>
                    </div>
                  </Show>
                </div>

                <div class={styles.serverActions}>
                  <Show when={serverInfo.status === 'disabled'}>
                    <button
                      class={styles.actionButton}
                      onClick={() => handleConnect(serverInfo.name)}
                    >
                      Connect
                    </button>
                  </Show>

                  <Show when={serverInfo.status === 'connected'}>
                    <button
                      class={styles.actionButton}
                      classList={{ [styles.disconnectButton]: true }}
                      onClick={() => handleDisconnect(serverInfo.name)}
                    >
                      Disconnect
                    </button>
                  </Show>

                  <Show when={serverInfo.status === 'needs_auth'}>
                    <button
                      class={styles.actionButton}
                      onClick={() => handleAuthenticate(serverInfo.name)}
                    >
                      Authenticate
                    </button>
                  </Show>

                  <Show when={serverInfo.status === 'failed'}>
                    <button
                      class={styles.actionButton}
                      onClick={() => handleConnect(serverInfo.name)}
                    >
                      Retry
                    </button>
                  </Show>

                  <Show when={serverInfo.status === 'needs_client_registration'}>
                    <button class={styles.actionButton} disabled>
                      Register
                    </button>
                  </Show>
                </div>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}
