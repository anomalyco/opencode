// FORK: 飞书扫码绑定弹窗(C1.5)[feat: feishu-bridge] 2026-05-08
//
// 流程:
//   1. 用户选 domain(feishu / lark)+ 点"开始绑定"
//   2. 调 invoke("feishu_oauth_start") 拿 device_code / user_code / verification_uri
//   3. 显示 user_code 大字 + verification_uri 链接 + 倒计时 + "等待授权..."
//      (v1 不画 QR,显文本 + 链接;真 QR 渲染等单独一笔加 qrcode 依赖再做)
//   4. 按 interval 间隔轮询 invoke("feishu_oauth_poll")
//   5. 终态:success → 通知绑定完成 + close;denied/expired → 显错误 + 重试按钮
//
// 注:Phase 3 接入 SecretRef 写 ~/.opencode/feishu-config.json;v1 弹窗只跑通 OAuth flow,
// 拿到 {appId, appSecret, openId} 后暂时仅 console.log + 显示成功状态。

import {
  type Component,
  createEffect,
  createSignal,
  Match,
  onCleanup,
  Show,
  Switch,
} from "solid-js"
import { Dialog } from "@opencode-ai/ui/dialog"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useLanguage } from "@/context/language"
import {
  feishuOauthPoll,
  feishuOauthStart,
  type FeishuDomain,
  type OauthPollResponse,
  type OauthStartResponse,
} from "@/utils/feishu-config"

type Phase =
  | { kind: "select" }
  | { kind: "loading" }
  | { kind: "waiting"; data: OauthStartResponse }
  | { kind: "success"; result: OauthPollResponse }
  | { kind: "error"; message: string; canRetry: boolean }

export const FeishuBindDialog: Component = () => {
  const dialog = useDialog()
  const language = useLanguage()
  const [domain, setDomain] = createSignal<FeishuDomain>("feishu")
  const [phase, setPhase] = createSignal<Phase>({ kind: "select" })
  const [secsLeft, setSecsLeft] = createSignal(0)

  let pollTimer: ReturnType<typeof setTimeout> | null = null
  let countdownTimer: ReturnType<typeof setInterval> | null = null

  const stopAllTimers = () => {
    if (pollTimer) {
      clearTimeout(pollTimer)
      pollTimer = null
    }
    if (countdownTimer) {
      clearInterval(countdownTimer)
      countdownTimer = null
    }
  }

  const startBind = async () => {
    setPhase({ kind: "loading" })
    try {
      const data = await feishuOauthStart(domain())
      setPhase({ kind: "waiting", data })
      setSecsLeft(data.expires_in)
      // 倒计时
      countdownTimer = setInterval(() => {
        setSecsLeft((s) => Math.max(0, s - 1))
      }, 1000)
      // 启动轮询
      schedulePoll(data.session_id, data.interval * 1000)
    } catch (err) {
      setPhase({
        kind: "error",
        message: (err as Error).message ?? String(err),
        canRetry: true,
      })
    }
  }

  const schedulePoll = (sessionId: string, intervalMs: number) => {
    pollTimer = setTimeout(async () => {
      try {
        const r = await feishuOauthPoll(sessionId)
        switch (r.status) {
          case "success":
            stopAllTimers()
            setPhase({ kind: "success", result: r })
            // TODO Phase 3:落 SecretRef + 通知 settings 刷新
            console.log("[feishu-bridge] OAuth success:", {
              appId: r.app_id,
              openId: r.open_id,
            })
            return
          case "denied":
            stopAllTimers()
            setPhase({
              kind: "error",
              message: language.t("settings.feishu.bind.statusDenied"),
              canRetry: true,
            })
            return
          case "expired":
            stopAllTimers()
            setPhase({
              kind: "error",
              message: language.t("settings.feishu.bind.statusExpired"),
              canRetry: true,
            })
            return
          case "slow_down":
            // 服务端要求慢点,加倍 interval
            schedulePoll(sessionId, intervalMs * 2)
            return
          case "pending":
            schedulePoll(sessionId, intervalMs)
            return
          case "error":
            stopAllTimers()
            setPhase({
              kind: "error",
              message: language.t("settings.feishu.bind.statusError", {
                msg: r.message ?? r.code ?? "unknown",
              }),
              canRetry: true,
            })
            return
        }
      } catch (err) {
        // 网络错误等单次失败 → 继续重试,不终止
        console.warn("[feishu-bridge] poll error, retrying:", err)
        schedulePoll(sessionId, intervalMs)
      }
    }, intervalMs)
  }

  // expires_in 到 0 时停止轮询并显错
  createEffect(() => {
    const p = phase()
    if (p.kind === "waiting" && secsLeft() <= 0) {
      stopAllTimers()
      setPhase({
        kind: "error",
        message: language.t("settings.feishu.bind.statusExpired"),
        canRetry: true,
      })
    }
  })

  onCleanup(() => stopAllTimers())

  return (
    <Dialog title={language.t("settings.feishu.bind.title")}>
      <div class="flex flex-col gap-4 p-4 min-w-md max-w-lg">
        <Switch>
          {/* 阶段 1:选 domain + 开始 */}
          <Match when={phase().kind === "select"}>
            <div class="flex flex-col gap-3">
              <label class="text-13-medium">
                {language.t("settings.feishu.bind.domain.label")}
              </label>
              <div class="flex gap-2">
                <button
                  type="button"
                  class={`px-3 py-1.5 rounded-md text-13-medium ${
                    domain() === "feishu"
                      ? "bg-surface-strong"
                      : "bg-surface-base hover:bg-surface-strong"
                  }`}
                  onClick={() => setDomain("feishu")}
                >
                  {language.t("settings.feishu.bind.domain.feishu")}
                </button>
                <button
                  type="button"
                  class={`px-3 py-1.5 rounded-md text-13-medium ${
                    domain() === "lark"
                      ? "bg-surface-strong"
                      : "bg-surface-base hover:bg-surface-strong"
                  }`}
                  onClick={() => setDomain("lark")}
                >
                  {language.t("settings.feishu.bind.domain.lark")}
                </button>
              </div>
              <div class="flex justify-end gap-2 mt-2">
                <button
                  type="button"
                  class="px-3 py-1.5 rounded-md text-13-medium bg-surface-base hover:bg-surface-strong"
                  onClick={() => dialog.close()}
                >
                  {language.t("settings.feishu.bind.cancel")}
                </button>
                <button
                  type="button"
                  class="px-3 py-1.5 rounded-md text-13-medium bg-surface-strong hover:bg-surface-stronger"
                  onClick={() => void startBind()}
                >
                  {language.t("settings.feishu.account.add")}
                </button>
              </div>
            </div>
          </Match>

          {/* 阶段 2:loading */}
          <Match when={phase().kind === "loading"}>
            <p class="text-13-regular text-text-weak text-center py-6">
              {language.t("settings.feishu.bind.statusPending")}
            </p>
          </Match>

          {/* 阶段 3:waiting — user_code + verification_uri + 倒计时 */}
          <Match when={phase().kind === "waiting"}>
            {(() => {
              const p = phase() as { kind: "waiting"; data: OauthStartResponse }
              return (
                <div class="flex flex-col gap-3">
                  <p class="text-13-regular text-text-weak">
                    {language.t("settings.feishu.bind.scanQr")}
                  </p>
                  {/* TODO C1.5b:加 qrcode 依赖渲染真 QR;v1 仅显文本链接 */}
                  <a
                    href={p.data.verification_uri_complete}
                    target="_blank"
                    rel="noopener noreferrer"
                    class="text-13-regular text-text-base underline break-all"
                  >
                    {p.data.verification_uri_complete}
                  </a>
                  <div class="flex flex-col items-center gap-1.5 py-3">
                    <span class="text-12-regular text-text-weak">
                      {language.t("settings.feishu.bind.userCodeLabel")}
                    </span>
                    <span class="text-24-medium tracking-widest font-mono">
                      {p.data.user_code}
                    </span>
                  </div>
                  <p class="text-12-regular text-text-weak text-center">
                    {language.t("settings.feishu.bind.expiresIn", { secs: String(secsLeft()) })}
                  </p>
                  <p class="text-12-regular text-text-weak text-center">
                    {language.t("settings.feishu.bind.statusPending")}
                  </p>
                  <div class="flex justify-end mt-2">
                    <button
                      type="button"
                      class="px-3 py-1.5 rounded-md text-13-medium bg-surface-base hover:bg-surface-strong"
                      onClick={() => {
                        stopAllTimers()
                        dialog.close()
                      }}
                    >
                      {language.t("settings.feishu.bind.cancel")}
                    </button>
                  </div>
                </div>
              )
            })()}
          </Match>

          {/* 阶段 4:success */}
          <Match when={phase().kind === "success"}>
            <div class="flex flex-col gap-3 items-center py-4">
              <p class="text-16-medium">
                {language.t("settings.feishu.bind.statusSuccess")}
              </p>
              <button
                type="button"
                class="px-3 py-1.5 rounded-md text-13-medium bg-surface-strong hover:bg-surface-stronger"
                onClick={() => dialog.close()}
              >
                {language.t("settings.feishu.bind.cancel")}
              </button>
            </div>
          </Match>

          {/* 阶段 5:error */}
          <Match when={phase().kind === "error"}>
            {(() => {
              const p = phase() as { kind: "error"; message: string; canRetry: boolean }
              return (
                <div class="flex flex-col gap-3">
                  <p class="text-13-regular text-text-warning">{p.message}</p>
                  <div class="flex justify-end gap-2">
                    <button
                      type="button"
                      class="px-3 py-1.5 rounded-md text-13-medium bg-surface-base hover:bg-surface-strong"
                      onClick={() => dialog.close()}
                    >
                      {language.t("settings.feishu.bind.cancel")}
                    </button>
                    <Show when={p.canRetry}>
                      <button
                        type="button"
                        class="px-3 py-1.5 rounded-md text-13-medium bg-surface-strong hover:bg-surface-stronger"
                        onClick={() => setPhase({ kind: "select" })}
                      >
                        {language.t("settings.feishu.bind.retry")}
                      </button>
                    </Show>
                  </div>
                </div>
              )
            })()}
          </Match>
        </Switch>
      </div>
    </Dialog>
  )
}
