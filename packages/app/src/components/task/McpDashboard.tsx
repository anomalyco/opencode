import { Component, For, Show, createResource } from 'solid-js'
import { useServer } from '@/context/server'
import { useLanguage } from '@/context/language'
import { Icon } from '@opencode-ai/ui/icon'
import { Button } from '@opencode-ai/ui/button'
import { Tag } from '@opencode-ai/ui/tag'

export interface McpServerStatus {
  name: string
  status: 'connected' | 'disabled' | 'failed' | 'needs_auth' | 'needs_client_registration'
  error?: string
}

const fetchMcpStatus = async (serverUrl: string): Promise<McpServerStatus[]> => {
  try {
    const mcpUrl = `${serverUrl}/mcp`
    const response = await fetch(mcpUrl)
    if (!response.ok) {
      console.warn(`MCP endpoint returned ${response.status}: ${response.statusText}`)
      return []
    }

    const contentType = response.headers.get('content-type')
    if (!contentType || !contentType.includes('application/json')) {
      console.warn('MCP endpoint did not return JSON')
      return []
    }

    const data: Record<string, { status: string; error?: string }> = await response.json()

    const servers: McpServerStatus[] = Object.entries(data).map(([name, info]) => ({
      name,
      status: info.status as McpServerStatus['status'],
      error: info.error,
    }))

    return servers
  } catch (error) {
    console.error('Failed to fetch MCP status:', error)
    return []
  }
}

export const McpDashboard: Component = () => {
  const server = useServer()
  const language = useLanguage()
  const [status, { refetch }] = createResource(async () => {
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
        refetch()
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
        refetch()
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
        refetch()
      }
    } catch (error) {
      console.error(`Failed to authenticate ${name}:`, error)
    }
  }

  const getStatusIcon = (status: McpServerStatus['status']): { name: string; class: string } => {
    switch (status) {
      case 'connected':
        return { name: 'circle-check', class: 'text-success' }
      case 'disabled':
        return { name: 'circle', class: 'text-text-weak' }
      case 'failed':
        return { name: 'warning-circle', class: 'text-error' }
      case 'needs_auth':
        return { name: 'lock', class: 'text-warning' }
      case 'needs_client_registration':
        return { name: 'warning', class: 'text-warning' }
      default:
        return { name: 'question', class: 'text-text-weak' }
    }
  }

  const getStatusText = (status: McpServerStatus['status']): string => {
    switch (status) {
      case 'connected':
        return language.t('settings.mcp.status.connected')
      case 'disabled':
        return language.t('settings.mcp.status.disabled')
      case 'failed':
        return language.t('settings.mcp.status.failed')
      case 'needs_auth':
        return language.t('settings.mcp.status.needs_auth')
      case 'needs_client_registration':
        return language.t('settings.mcp.status.needs_registration')
      default:
        return language.t('settings.mcp.status.unknown')
    }
  }

  const getActionButton = (serverInfo: McpServerStatus) => {
    switch (serverInfo.status) {
      case 'disabled':
        return (
          <Button
            size="small"
            variant="secondary"
            onClick={() => handleConnect(serverInfo.name)}
          >
            {language.t('common.connect')}
          </Button>
        )
      case 'connected':
        return (
          <Button
            size="small"
            variant="ghost"
            onClick={() => handleDisconnect(serverInfo.name)}
          >
            {language.t('common.disconnect')}
          </Button>
        )
      case 'needs_auth':
        return (
          <Button
            size="small"
            variant="secondary"
            onClick={() => handleAuthenticate(serverInfo.name)}
          >
            {language.t('settings.mcp.authenticate')}
          </Button>
        )
      case 'failed':
        return (
          <Button
            size="small"
            variant="secondary"
            onClick={() => handleConnect(serverInfo.name)}
          >
            {language.t('settings.mcp.retry')}
          </Button>
        )
      case 'needs_client_registration':
        return (
          <Button size="small" variant="secondary" disabled>
            {language.t('settings.mcp.register')}
          </Button>
        )
      default:
        return null
    }
  }

  return (
    <div class="flex flex-col gap-8 max-w-[720px]">
      <Show when={status.loading}>
        <div class="py-8 text-center">
          <div class="inline-block w-6 h-6 border-2 border-border-strong-subtle border-t-transparent rounded-full animate-spin mb-3" />
          <div class="text-14-regular text-text-weak">{language.t('settings.mcp.loading')}</div>
        </div>
      </Show>

      <Show
        when={status().length > 0}
        fallback={
          <Show when={!status.loading}>
            <div class="bg-surface-raised-base px-4 py-8 rounded-lg text-center">
              <Icon name="cpu" class="w-12 h-12 mx-auto mb-3 text-icon-weak-subtle" />
              <div class="text-14-regular text-text-weak">{language.t('settings.mcp.empty')}</div>
            </div>
          </Show>
        }
      >
        <div class="bg-surface-raised-base px-4 rounded-lg">
          <For each={status()}>
            {(serverInfo) => {
              const statusIcon = getStatusIcon(serverInfo.status)
              return (
                <div class="flex items-center justify-between gap-4 py-3 border-b border-border-weak-base last:border-none">
                  <div class="flex items-start gap-3 min-w-0 flex-1">
                    <Icon name={statusIcon.name as any} class={`w-5 h-5 shrink-0 mt-0.5 ${statusIcon.class}`} />
                    <div class="flex flex-col gap-1 min-w-0 flex-1">
                      <div class="flex items-center gap-2">
                        <span class="text-14-regular text-text-strong truncate">{serverInfo.name}</span>
                        <Tag>{getStatusText(serverInfo.status)}</Tag>
                      </div>
                      <Show when={serverInfo.error}>
                        <p class="text-13-regular text-text-warning line-clamp-1">{serverInfo.error}</p>
                      </Show>
                    </div>
                  </div>
                  {getActionButton(serverInfo)}
                </div>
              )
            }}
          </For>
        </div>
      </Show>
    </div>
  )
}
