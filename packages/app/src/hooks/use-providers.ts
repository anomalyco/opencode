import { useGlobalSync } from "@/context/global-sync"
import { decode64 } from "@/utils/base64"
// FORK: 引入 getbot 内置元数据 2026-04-26
import { GETBOT_PROVIDER_ID, GETBOT_PROVIDER_NAME } from "@/utils/getbot"
import { useParams } from "@solidjs/router"
import { createMemo } from "solid-js"

export const popularProviders = [
  // FORK: getbot 紧跟 opencode/zen 之后(model 选择器自然顺序);provider 弹窗里另外 override 把它顶到首位 2026-04-26
  "opencode",
  GETBOT_PROVIDER_ID,
  "opencode-go",
  "anthropic",
  "github-copilot",
  "openai",
  "google",
  "openrouter",
  "vercel",
]
const popularProviderSet = new Set(popularProviders)

// FORK-BEGIN: 未配置时注入合成 getbot 项，让其在 provider 弹窗中可见 2026-04-26
const GETBOT_SYNTHETIC = {
  id: GETBOT_PROVIDER_ID,
  name: GETBOT_PROVIDER_NAME,
  source: "custom" as const,
  env: [],
  options: {},
  models: {},
}

function withGetbot<T extends { id: string }>(list: readonly T[]): T[] {
  if (list.some((p) => p.id === GETBOT_PROVIDER_ID)) return list as T[]
  return [GETBOT_SYNTHETIC as unknown as T, ...list]
}
// FORK-END

export function useProviders() {
  const globalSync = useGlobalSync()
  const params = useParams()
  const dir = createMemo(() => decode64(params.dir) ?? "")
  const providers = () => {
    if (dir()) {
      const [projectStore] = globalSync.child(dir())
      if (projectStore.provider_ready) return projectStore.provider
    }
    return globalSync.data.provider
  }
  return {
    // FORK: all/popular 包裹 withGetbot 以注入合成项 2026-04-26
    all: () => withGetbot(providers().all),
    default: () => providers().default,
    popular: () => withGetbot(providers().all).filter((p) => popularProviderSet.has(p.id)),
    connected: () => {
      const connected = new Set(providers().connected)
      return providers().all.filter((p) => connected.has(p.id))
    },
    paid: () => {
      const connected = new Set(providers().connected)
      return providers().all.filter(
        (p) => connected.has(p.id) && (p.id !== "opencode" || Object.values(p.models).some((m) => m.cost?.input)),
      )
    },
  }
}
