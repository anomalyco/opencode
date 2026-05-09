// FORK: 飞书扫码绑定弹窗(C1.5 + C1.5b QR 渲染 + 自动 domain 选择)
// [feat: feishu-bridge] 2026-05-08
//
// 流程(简化版,不让用户选 domain):
//   1. 进 dialog 即 loading,根据 i18n locale 自动选 domain:
//      - zh / zht → "feishu"(accounts.feishu.cn)
//      - 其它    → "lark"(accounts.larksuite.com)
//   2. invoke("feishu_oauth_start") 拿 device_code / user_code / verification_uri
//   3. 用 qrcode 包把 verification_uri_complete 渲染成 PNG dataURL → <img>
//   4. 显 QR + user_code 大字 + 倒计时 + "等待用户授权..."
//   5. 底部小字"切换到 Lark/飞书"链接(default 错时 fallback)
//   6. 按 interval 间隔轮询 invoke("feishu_oauth_poll")
//   7. 终态:success → 通知绑定完成 + close;denied/expired/error → 显错误 + 重试
//
// 注:Phase 3 接入 SecretRef 写 ~/.opencode/feishu-config.json;v1 弹窗只跑通 OAuth flow,
// 拿到 {appId, appSecret, openId} 后暂时仅 console.log + 显示成功状态。

import {
  type Component,
  createEffect,
  createSignal,
  Match,
  onCleanup,
  onMount,
  Show,
  Switch,
} from "solid-js"
import QRCode from "qrcode"
import { Dialog } from "@opencode-ai/ui/dialog"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useLanguage } from "@/context/language"
import {
  feishuOauthPoll,
  feishuOauthStart,
  feishuSaveAccount,
  type FeishuDomain,
  type OauthPollResponse,
  type OauthStartResponse,
} from "@/utils/feishu-config"

type Phase =
  | { kind: "loading" }
  | { kind: "waiting"; data: OauthStartResponse; qrDataUrl: string | null }
  | { kind: "success"; result: OauthPollResponse }
  | { kind: "error"; message: string; canRetry: boolean }

/** locale → 默认飞书域名(zh / zht 优先国内,其它默认国际)*/
function defaultDomainFor(locale: string): FeishuDomain {
  return locale === "zh" || locale === "zht" ? "feishu" : "lark"
}

export const FeishuBindDialog: Component<{ onBound?: () => void }> = (props) => {
  const dialog = useDialog()
  const language = useLanguage()
  const [domain, setDomain] = createSignal<FeishuDomain>(defaultDomainFor(language.locale()))
  const [phase, setPhase] = createSignal<Phase>({ kind: "loading" })
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

  const startBind = async (selectedDomain: FeishuDomain) => {
    stopAllTimers()
    setDomain(selectedDomain)
    setPhase({ kind: "loading" })
    try {
      const data = await feishuOauthStart(selectedDomain)
      // 立即生成 QR(qrcode toDataURL 异步)
      let qrDataUrl: string | null = null
      try {
        qrDataUrl = await QRCode.toDataURL(data.verification_uri_complete, {
          width: 240,
          margin: 1,
          errorCorrectionLevel: "M",
        })
      } catch (qrErr) {
        // QR 生成失败不阻断流程,仅 fallback 显文本链接
        console.warn("[feishu-bridge] QR generation failed:", qrErr)
      }
      // ⚠️ 先 setSecsLeft 再 setPhase — 防 createEffect 看到 phase=waiting + secsLeft=0
      // 立即触发 "二维码已过期" expired 分支
      setSecsLeft(data.expires_in)
      setPhase({ kind: "waiting", data, qrDataUrl })
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
            // 凭证落盘 — appSecret 走 SecretRef file mode(0600)
            if (r.app_id && r.app_secret && r.open_id) {
              try {
                await feishuSaveAccount({
                  domain: domain(),
                  app_id: r.app_id,
                  app_secret: r.app_secret,
                  open_id: r.open_id,
                })
                props.onBound?.() // 通知 settings-feishu 刷新列表
              } catch (saveErr) {
                console.warn("[feishu-bridge] save account failed:", saveErr)
                // 落盘失败不阻断:OAuth success 仍展示给 user,后续重试 / 重新绑定即可
              }
            }
            setPhase({ kind: "success", result: r })
            console.log("[feishu-bridge] OAuth success:", {
              appId: r.app_id,
              openId: r.open_id,
            })
            // 1.2s 后自动关 dialog 回到列表(列表已经 onBound 触发 refetch)
            setTimeout(() => dialog.close(), 1200)
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

  // 进 dialog 即自动启动
  onMount(() => {
    void startBind(domain())
  })

  onCleanup(() => stopAllTimers())

  return (
    <Dialog title={language.t("settings.feishu.bind.title")}>
      <div class="flex flex-col gap-4 p-4 min-w-md max-w-lg mx-auto items-stretch">
        <Switch>
          {/* 阶段 1:loading */}
          <Match when={phase().kind === "loading"}>
            <p class="text-13-regular text-text-weak text-center py-8">
              {language.t("settings.feishu.bind.qrLoading")}
            </p>
          </Match>

          {/* 阶段 2:waiting — QR + user_code + 倒计时 */}
          <Match when={phase().kind === "waiting"}>
            {(() => {
              const p = phase() as {
                kind: "waiting"
                data: OauthStartResponse
                qrDataUrl: string | null
              }
              return (
                <div class="flex flex-col gap-3 items-center">
                  <p class="text-13-regular text-text-weak text-center">
                    {language.t("settings.feishu.bind.scanQr")}
                  </p>

                  {/* QR 图 */}
                  <Show
                    when={p.qrDataUrl}
                    fallback={
                      <div class="text-12-regular text-text-weak py-4">
                        {language.t("settings.feishu.bind.qrLoading")}
                      </div>
                    }
                  >
                    <img
                      src={p.qrDataUrl ?? ""}
                      alt="QR code"
                      width={240}
                      height={240}
                      class="rounded bg-white p-2"
                    />
                  </Show>

                  <p class="text-12-regular text-text-weak">
                    {language.t("settings.feishu.bind.expiresIn", { secs: String(secsLeft()) })}
                  </p>
                  <p class="text-12-regular text-text-weak">
                    {language.t("settings.feishu.bind.statusPending")}
                  </p>

                  {/* 域切换 — 默认按 locale 自动选(zh/zht=feishu, 其它=lark);user 自动判断错时手动切 */}
                  <button
                    type="button"
                    class="text-11-regular text-text-weak hover:text-text-base underline mt-1"
                    onClick={() => {
                      const next: FeishuDomain = domain() === "feishu" ? "lark" : "feishu"
                      void startBind(next)
                    }}
                  >
                    {domain() === "feishu"
                      ? language.t("settings.feishu.bind.switchToLark")
                      : language.t("settings.feishu.bind.switchToFeishu")}
                  </button>
                </div>
              )
            })()}
          </Match>

          {/* 阶段 3:success */}
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
                {language.t("settings.feishu.bind.done")}
              </button>
            </div>
          </Match>

          {/* 阶段 4:error */}
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
                        onClick={() => void startBind(domain())}
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
