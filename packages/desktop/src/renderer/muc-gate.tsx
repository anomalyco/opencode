// 校园 Harness（MUC / HUBU 共用）：首次连接门 —— 未连接账户时以品牌页拦截主界面；
// 处理 <scheme>://connect?code= 冷/热启动流程：验证授权 → 存凭据 → 同步模型 → 进入主界面。
// 品牌数据来自 @opencode-ai/brand（muc 渲染与历史版本一致）。

import { Show, createContext, createSignal, useContext, onMount, onCleanup, type JSX, type Accessor } from "solid-js"
import { resolveBrand } from "@opencode-ai/brand"
import mucCampusImg from "./assets/muc-campus.png"
import hubuHeroImg from "./assets/hubu-hero.png"

const brand = resolveBrand()
const campusImg = brand.id === "hubu" ? hubuHeroImg : mucCampusImg
const siteOrigin = (): string => {
  // muc 保持历史逻辑（本地渲染时跳正式站）；hubu 走品牌网关
  if (brand.id === "muc") {
    return `${location.protocol}//${location.hostname === "localhost" ? "admin.wuxuexi.top" : location.hostname}`
  }
  return brand.gatewayURL
}

type MucState =
  | { connected: false }
  | { connected: true; gateway: string; keyName: string; deviceId: string; user: string; connectedAt: string }

type Phase =
  | { kind: "not-connected" }
  | { kind: "connecting"; step: "exchange" | "verify" | "sync" }
  | { kind: "success"; modelCount?: number }
  | { kind: "error"; error: string }

const MucGateContext = createContext<{ ready: Accessor<boolean> }>()

export function useMucGate(): { ready: Accessor<boolean> } {
  const ctx = useContext(MucGateContext)
  if (!ctx) return { ready: () => true }
  return ctx
}

export function createMucGate(): { ready: Accessor<boolean>; MucGate: (props: { children: JSX.Element }) => JSX.Element } {
  const [ready, setReady] = createSignal(false)
  const [phase, setPhase] = createSignal<Phase>({ kind: "not-connected" })

  async function runConnect(code: string): Promise<void> {
    setPhase({ kind: "connecting", step: "exchange" })
    try {
      setPhase({ kind: "connecting", step: "verify" })
      const result = await window.api.mucConnect(code)
      if (!result.ok) {
        const messages: Record<string, string> = {
          invalid_code: "授权码格式无效",
          invalid: "授权码无效，请从网站重新发起连接",
          expired: "授权码已过期，请从网站重新发起连接",
          used: "授权码已被使用，请从网站重新发起连接",
          network: "无法连接授权服务器，请检查网络",
          bad_response: "授权服务器响应异常",
          unknown: "连接失败，请重试",
        }
        setPhase({ kind: "error", error: messages[result.error] ?? "连接失败" })
        return
      }
      setPhase({ kind: "connecting", step: "sync" })
      // 模型计数随 connect 响应返回；稍作停留让用户看到"正在同步"
      await new Promise((r) => setTimeout(r, 400))
      setPhase({ kind: "success", modelCount: result.modelCount })
    } catch {
      setPhase({ kind: "error", error: "连接失败，请重试" })
    }
  }

  onMount(() => {
    void (async () => {
      const state = (await window.api.mucGetState()) as MucState
      if (state.connected) {
        setReady(true)
        return
      }
      const pending = await window.api.mucPendingCode()
      if (pending) {
        await runConnect(pending)
        return
      }
      setPhase({ kind: "not-connected" })
    })()
  })

  // 热启动深链：连接门挂起期间收到新的 <scheme>://connect
  const onDeepLink = (event: Event): void => {
    const detail = (event as CustomEvent<{ urls: string[] }>).detail
    for (const url of detail?.urls ?? []) {
      if (!url.startsWith(`${brand.protocolScheme}://`)) continue
      try {
        const u = new URL(url)
        const code = u.searchParams.get("code")
        if (code) void runConnect(code)
      } catch {}
    }
  }
  window.addEventListener("opencode:deep-link", onDeepLink)
  onCleanup(() => window.removeEventListener("opencode:deep-link", onDeepLink))

  const MucGate = (props: { children: JSX.Element }): JSX.Element => {
    return (
      <Show when={ready()} fallback={<MucConnectPage phase={phase()} onRetry={() => setPhase({ kind: "not-connected" })} />}>
        {props.children}
      </Show>
    )
  }

  return { ready, MucGate }
}

function MucConnectPage(props: { phase: Phase; onRetry: () => void }): JSX.Element {
  const connectingLabel = (): string => {
    if (props.phase.kind !== "connecting") return ""
    if (props.phase.step === "exchange") return "正在连接账户..."
    if (props.phase.step === "verify") return "正在验证授权..."
    return "正在同步模型..."
  }
  return (
    <div
      class="relative flex h-screen w-screen flex-col items-center justify-center overflow-hidden text-white"
      style={{ "background-color": brand.colors.background }}
    >
      <img src={campusImg} alt="" class="pointer-events-none absolute inset-x-0 bottom-0 w-full object-cover object-bottom opacity-90" />
      <div
        class="absolute inset-0"
        style={{
          background: `linear-gradient(to bottom, ${brand.colors.background}, ${brand.colors.background}b3 70%, transparent)`,
          "background-size": "100% 60%",
          "background-repeat": "no-repeat",
          "background-position": "top",
        }}
      />
      <div class="relative z-10 flex flex-col items-center gap-3 px-6 text-center">
        <h1 class="text-3xl font-bold tracking-widest">{brand.name}</h1>
        <p class="text-sm" style={{ color: brand.colors.onDarkSoft }}>
          {brand.splash.subtitle}
        </p>
        <Show when={brand.splash.showFounded}>
          <p class="text-xs tracking-[0.3em]" style={{ color: brand.colors.gold }}>
            {brand.founded}
          </p>
        </Show>
        <p class="mt-2" style={{ color: brand.colors.gold }}>
          {brand.mottoDisplay}
        </p>
      </div>
      <div class="relative z-10 mt-10 flex w-[420px] max-w-[90vw] flex-col items-center gap-4">
        <Show
          when={props.phase.kind !== "not-connected"}
          fallback={
            <>
              <p class="text-sm text-gray-300">尚未连接账户</p>
              <button
                class="rounded-xl px-8 py-3 text-sm font-semibold text-white shadow transition"
                style={{ "background-color": brand.colors.primary }}
                onClick={() => window.open(`${siteOrigin()}${brand.sitePath}`, "_blank")}
              >
                从网站连接 {brand.shortName}
              </button>
              <p class="text-xs text-gray-400">等待网站授权... 登录网站后点击「一键连接 {brand.shortName}」</p>
            </>
          }
        >
          <Show
            when={props.phase.kind !== "connecting"}
            fallback={
              <div class="flex flex-col items-center gap-3">
                <div class="h-8 w-8 animate-spin rounded-full border-2" style={{ "border-color": brand.colors.primary, "border-top-color": "transparent" }} />
                <p class="text-sm text-gray-200">{connectingLabel()}</p>
              </div>
            }
          >
            <Show
              when={props.phase.kind === "success"}
              fallback={
                <div class="rounded-xl border border-red-800 bg-red-950/60 p-4 text-sm text-red-200">
                  <p class="font-medium">连接失败</p>
                  <p class="mt-1">{props.phase.kind === "error" ? props.phase.error : ""}</p>
                  <button class="mt-3 rounded-lg px-4 py-2 text-xs text-white" style={{ "background-color": brand.colors.primary }} onClick={() => props.onRetry()}>
                    返回
                  </button>
                </div>
              }
            >
              <div class="w-full rounded-2xl border border-white/10 bg-black/50 p-5 text-sm">
                <p class="font-medium text-emerald-400">✓ 账户连接成功</p>
                <p class="mt-1 text-gray-300">✓ 凭据已安全保存（系统钥匙串）</p>
                <p class="mt-1 text-gray-300">
                  ✓ 已同步{props.phase.kind === "success" && props.phase.modelCount ? ` ${props.phase.modelCount} 个` : ""}模型
                </p>
                <button
                  class="mt-4 w-full rounded-xl px-4 py-3 text-sm font-semibold text-white transition"
                  style={{ "background-color": brand.colors.primary }}
                  onClick={() => window.api.relaunch()}
                >
                  开始使用
                </button>
              </div>
            </Show>
          </Show>
        </Show>
      </div>
      <Show when={brand.splash.footer}>
        <p class="absolute bottom-5 left-0 right-0 z-10 text-center text-xs" style={{ color: brand.colors.mutedOnDark }}>
          {brand.splash.footer}
        </p>
      </Show>
    </div>
  )
}
