/**
 * Config Context Provider
 *
 * Provides access to ClaxedoConfig throughout the app.
 * This allows components to conditionally render based on feature flags.
 */

import { createContext, useContext, type ParentProps } from "solid-js"
import type { ClaxedoConfig } from "../index"

const ConfigContext = createContext<ClaxedoConfig>()

export interface ConfigProviderProps extends ParentProps {
  config: ClaxedoConfig
}

/**
 * Provides ClaxedoConfig to the component tree.
 * Wrap your app with this provider to enable useConfig() hook.
 */
export function ConfigProvider(props: ConfigProviderProps) {
  return (
    <ConfigContext.Provider value={props.config}>
      {props.children}
    </ConfigContext.Provider>
  )
}

/**
 * Access the ClaxedoConfig from context.
 * Must be used within a ConfigProvider.
 *
 * @example
 * ```tsx
 * const config = useConfig()
 * if (config.sandboxEnabled) {
 *   // Show cloud options
 * }
 * ```
 */
export function useConfig(): ClaxedoConfig {
  const ctx = useContext(ConfigContext)
  if (!ctx) {
    throw new Error("useConfig must be used within ConfigProvider")
  }
  return ctx
}

/**
 * Access the ClaxedoConfig from context, returning undefined if not available.
 * Useful for optional config access in components that may be used outside ConfigProvider.
 */
export function useConfigOptional(): ClaxedoConfig | undefined {
  return useContext(ConfigContext)
}
