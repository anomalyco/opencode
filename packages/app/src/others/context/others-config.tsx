import { createSimpleContext } from "@opencode-ai/ui/context"
import { createStore } from "solid-js/store"
import { onMount } from "solid-js"
import type { ServerConnection } from "@/context/server"

/**
 * UI 元素配置
 */
export interface UIElementConfig {
  terminalToggle: boolean
}

/**
 * Others 配置
 */
export interface OthersConfig {
  ui?: UIElementConfig
}

/**
 * Others 配置状态
 */
export interface OthersConfigState {
  isLoading: boolean
  config: OthersConfig
  error: string | null
}

// 默认 UI 配置
const defaultUIConfig: UIElementConfig = {
  terminalToggle: true,
}

// 默认配置
const defaultConfig: OthersConfig = {
  ui: defaultUIConfig,
}

export const { use: useOthersConfig, provider: OthersConfigProvider } = createSimpleContext({
  name: "OthersConfig",
  init: (props: { serverUrl: string }) => {
    const [state, setState] = createStore<OthersConfigState>({
      isLoading: true,
      config: defaultConfig,
      error: null,
    })

    // 获取配置
    const fetchConfig = async () => {
      try {
        const response = await fetch(`${props.serverUrl}/others/config`)

        if (!response.ok) {
          throw new Error(`Failed to fetch config: ${response.status}`)
        }

        const config = (await response.json()) as OthersConfig
        setState({
          config,
          isLoading: false,
          error: null,
        })
      } catch (error) {
        setState({
          isLoading: false,
          error: error instanceof Error ? error.message : "Failed to fetch config",
        })
      }
    }

    // 更新配置
    const updateConfig = async (config: Partial<OthersConfig>): Promise<boolean> => {
      try {
        const response = await fetch(`${props.serverUrl}/others/config`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(config),
        })

        if (!response.ok) {
          throw new Error(`Failed to update config: ${response.status}`)
        }

        const updated = (await response.json()) as OthersConfig
        setState({ config: updated, error: null })
        return true
      } catch (error) {
        setState({
          error: error instanceof Error ? error.message : "Failed to update config",
        })
        return false
      }
    }

    // 获取 UI 配置
    const getUIConfig = (): UIElementConfig => {
      return {
        ...defaultUIConfig,
        ...state.config.ui,
      }
    }

    // 检查某个 UI 元素是否应该显示
    const shouldShowUIElement = (element: keyof UIElementConfig): boolean => {
      const uiConfig = getUIConfig()
      return uiConfig[element] ?? true
    }

    onMount(() => {
      fetchConfig()
    })

    return {
      get isLoading() {
        return state.isLoading
      },
      get config() {
        return state.config
      },
      get error() {
        return state.error
      },
      fetchConfig,
      updateConfig,
      getUIConfig,
      shouldShowUIElement,
    }
  },
})
