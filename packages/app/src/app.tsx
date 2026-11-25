import "@/index.css"
import { VoiceProvider } from "@/voice/context"
import { VoiceOverlay } from "@/voice/composer"
import { DialogProvider } from "@opencode/ui/context/dialog"
import { FileComponentProvider } from "@opencode/ui/context/file"
import { installFocusRescue } from "@opencode/ui/context/focus-rescue"
import { Font } from "@opencode/ui/font"
import { ThemeProvider } from "@opencode/ui/theme/context"
import { MetaProvider, Title } from "@solidjs/meta"
import { type BaseRouterProps, Router } from "@solidjs/router"
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query"
import {
  type Component,
  createRenderEffect,
  ErrorBoundary,
  type JSX,
  onCleanup,
  onMount,
  type ParentProps,
} from "solid-js"
import { Dynamic } from "solid-js/web"
import { CommandProvider } from "@/shell/commands/command"
import { DesktopCommands } from "@/shell/commands/desktop"
import { KeySequenceHint } from "@/shell/commands/key-sequence"
import { ProjectIconsProvider } from "@/shell/layout/project-icons"
import { GlobalProvider } from "@/runtime/server/runtime"
import { LanguageProvider, UiI18nBridge, type Locale } from "@/runtime/i18n/language"
import { ServerConnection, ServersProvider } from "@/runtime/server/registry"
import { SettingsProvider } from "@/settings/model"
import { TabsProvider } from "@/shell/tabs/tabs"
import { ErrorPage } from "@/shell/errors/error"
import { AppRoutes, File, preloadRoute } from "@/shell/routes/routes"
import { PluginRoot } from "@/runtime/plugin/root"
import { baseRouter } from "@/runtime/platform/base-path-router"

export { preloadRoute }

function QueryProvider(props: ParentProps) {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnReconnect: false,
        refetchOnWindowFocus: false,
        refetchOnMount: false,
      },
    },
  })

  return <QueryClientProvider client={client}>{props.children}</QueryClientProvider>
}

function BodyTypography() {
  createRenderEffect(() => {
    if (typeof document === "undefined") return
    document.body.classList.remove("text-12-regular")
    document.body.classList.add("font-(family-name:--font-family-text)", "text-[13px]", "font-[440]")
  })

  return null
}

// Prod crashes reach Sentry only when someone clicks Report; other channels send them as they happen.
// Builds that set no channel, such as the web app's, count as prod.
const CAPTURES_CRASHES = ["local", "dev", "beta"].includes(import.meta.env.VITE_OPENCODE_CHANNEL ?? "")

export function AppBaseProviders(
  props: ParentProps<{
    locale?: Locale
    onNativeTranslations?: Parameters<typeof LanguageProvider>[0]["onNativeTranslations"]
    onThemeApplied?: (mode: "light" | "dark", scheme: "system" | "light" | "dark") => void
    /** The selected theme or color scheme was written to `localStorage` under `key`. */
    onThemeStored?: (key: string, value: string) => void
  }>,
) {
  onMount(() => onCleanup(installFocusRescue()))

  return (
    <MetaProvider>
      <Title>OpenCode</Title>
      <Font />
      <ThemeProvider
        onThemeApplied={(mode, scheme) => props.onThemeApplied?.(mode, scheme)}
        onStored={(key, value) => props.onThemeStored?.(key, value)}
      >
        <LanguageProvider locale={props.locale} onNativeTranslations={props.onNativeTranslations}>
          <UiI18nBridge>
            <ErrorBoundary
              fallback={(error) => {
                if (CAPTURES_CRASHES)
                  void import("@sentry/solid").then(({ captureException }) => captureException(error))

                return <ErrorPage error={error} />
              }}
            >
              <QueryProvider>
                <DialogProvider>
                  <PluginRoot>
                    <FileComponentProvider component={File}>{props.children}</FileComponentProvider>
                  </PluginRoot>
                </DialogProvider>
              </QueryProvider>
            </ErrorBoundary>
          </UiI18nBridge>
        </LanguageProvider>
      </ThemeProvider>
    </MetaProvider>
  )
}

export function AppInterface(props: {
  children?: JSX.Element
  canonicalLocalServer?: ServerConnection.Key
  servers?: Array<ServerConnection.Any>
  router?: Component<BaseRouterProps>
}) {
  // The visual layout lives in the router root so it remains mounted across
  // route changes. Draft and session routes override only their server-bound data
  // providers beneath it.
  const Root = (rootProps: ParentProps) => (
    <TabsProvider>
      <GlobalProvider>
        <ProjectIconsProvider>
          <BodyTypography />
          <CommandProvider>
            <DesktopCommands />
            <VoiceProvider>
              {props.children}
              {rootProps.children}
              <VoiceOverlay />
            </VoiceProvider>
            <KeySequenceHint />
          </CommandProvider>
        </ProjectIconsProvider>
      </GlobalProvider>
    </TabsProvider>
  )

  return (
    <ServersProvider canonicalLocalServer={props.canonicalLocalServer} servers={props.servers}>
      <SettingsProvider>
        <Dynamic component={props.router ?? baseRouter ?? Router} root={Root}>
          <AppRoutes />
        </Dynamic>
      </SettingsProvider>
    </ServersProvider>
  )
}
