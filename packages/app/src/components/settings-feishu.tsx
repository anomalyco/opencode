// FORK: 飞书桥接 Settings Tab — 账户管理(C1.4 + C1.6 已绑定列表)[feat: feishu-bridge] 2026-05-08
//
// 范围:
//   - 标题 + 描述
//   - adapter ready 状态检查
//   - 已绑定账号列表(C1.6,从 ~/.opencode/feishu-config.json load)
//   - "添加飞书账号" 按钮 → 扫码弹窗
//   - 删除按钮(C1.6)
//
// 后续(Phase 3+):群组配置子 Tab / 健康检查子 Tab

import { type Component, createSignal, onMount, Show, For } from "solid-js"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useLanguage } from "@/context/language"
import {
  feishuAdapterStatus,
  feishuDeleteAccount,
  feishuListAccounts,
  feishuListProviders,
  type AccountSummary,
} from "@/utils/feishu-config"

/** open_id 脱敏:头 8 字符 + ⋯ + 尾 4 字符,中间用星号代替(避免泄露完整身份标识)*/
function maskOpenId(id: string): string {
  if (id.length <= 14) return id
  return `${id.slice(0, 8)}***${id.slice(-4)}`
}

export const SettingsFeishu: Component = () => {
  const language = useLanguage()
  const dialog = useDialog()
  const [adapterReady, setAdapterReady] = createSignal<boolean | null>(null)
  // ⚠️ 用 createSignal + 手动 fetch(避开 createResource 触发外层 Suspense fallback 导致整屏闪)
  // 同 file-tabs.tsx:1179 注释的处理方式
  const [accounts, setAccounts] = createSignal<AccountSummary[]>([])
  // null=loading,true=user 至少有一个 provider 配过 default model,false=完全没配 → 飞书消息进来会失败
  // opencode /providers 响应 default 字段是 Record<provider_id, model_id>(实测 2026-05-10:
  // key 是 provider id 如 "minimax-cn-coding-plan" / "opencode" / "claude-code",不是 agent name)
  const [hasDefaultModel, setHasDefaultModel] = createSignal<boolean | null>(null)

  const refetch = async () => {
    try {
      setAccounts(await feishuListAccounts())
    } catch {
      setAccounts([])
    }
  }

  const checkDefaultModel = async () => {
    try {
      const data = await feishuListProviders()
      const defaults = data.default ?? {}
      // 非空字典 = user 至少配过一个 provider 的 default model → 飞书桥接收消息时 opencode 能 routing
      setHasDefaultModel(Object.keys(defaults).length > 0)
    } catch {
      // 拿不到 providers 多半是 plugin server 本身就异常,adapter notReady 已会显示
      // 这里不二次报警,留 null(不渲染 warning)
      setHasDefaultModel(null)
    }
  }

  onMount(async () => {
    try {
      const ready = await feishuAdapterStatus()
      setAdapterReady(ready)
      if (ready) {
        await refetch()
        await checkDefaultModel()
      }
    } catch {
      setAdapterReady(false)
    }
  })

  // 关闭子 dialog(bind / edit)后 re-show settings,回到飞书桥接 tab
  // useDialog 当前不支持 dialog stack(show 时把上一个 dispose),只能这样补救
  const reshowSettings = () => {
    void import("./dialog-settings").then((m) => {
      dialog.show(() => <m.DialogSettings defaultTab="feishu" />)
    })
  }

  const openBindDialog = () => {
    void import("./feishu-bind-dialog").then((x) => {
      dialog.show(() => <x.FeishuBindDialog onBound={() => refetch()} />, reshowSettings)
    })
  }

  const handleDelete = async (accountId: string) => {
    try {
      await feishuDeleteAccount(accountId)
      refetch()
    } catch (err) {
      console.warn("[feishu-bridge] delete failed:", err)
    }
  }

  const handleEdit = (acc: AccountSummary) => {
    void import("./feishu-edit-account-dialog").then((x) => {
      dialog.show(
        () => (
          <x.FeishuEditAccountDialog
            accountId={acc.account_id}
            currentModel={acc.model ?? null}
            // [feat: feishu-create-group-toggle-gui] 2026-05-24
            currentEnableAutoGroupCreate={acc.enable_auto_group_create ?? false}
            // [feat: feishu-group-mention-policy] 2026-05-24
            currentRequireMention={acc.require_mention ?? true}
            onSaved={() => refetch()}
          />
        ),
        reshowSettings,
      )
    })
  }

  return (
    <div class="flex flex-col gap-6 h-full overflow-y-auto no-scrollbar p-4 max-w-2xl">
      {/* 标题 */}
      <div class="flex flex-col gap-1.5">
        <h2 class="text-16-medium">{language.t("settings.feishu.title")}</h2>
        <p class="text-13-regular text-text-weak">
          {language.t("settings.feishu.description")}
        </p>
      </div>

      {/* adapter 未就绪提示 */}
      <Show when={adapterReady() === false}>
        <div class="bg-surface-warning rounded-md p-4 flex flex-col gap-1.5">
          <p class="text-13-medium">
            {language.t("settings.feishu.adapter.notReady")}
          </p>
          <p class="text-12-regular text-text-weak">
            {language.t("settings.feishu.adapter.notReady.hint")}
          </p>
        </div>
      </Show>

      {/* 默认 LLM model 未配置警告 — 飞书消息进来会失败,即使绑了账号也是死循环 */}
      <Show when={adapterReady() === true && hasDefaultModel() === false}>
        <div class="bg-surface-warning rounded-md p-4 flex flex-col gap-1.5">
          <p class="text-13-medium">
            {language.t("settings.feishu.noDefaultModel.title")}
          </p>
          <p class="text-12-regular text-text-weak">
            {language.t("settings.feishu.noDefaultModel.hint")}
          </p>
        </div>
      </Show>

      {/* 账号列表区 */}
      <Show when={adapterReady() !== false}>
        <Show
          when={(accounts() ?? []).length > 0}
          fallback={
            <div class="bg-surface-base rounded-md p-6 flex flex-col items-center gap-3">
              <p class="text-13-medium">
                {language.t("settings.feishu.account.empty.title")}
              </p>
              <p class="text-12-regular text-text-weak text-center">
                {language.t("settings.feishu.account.empty.description")}
              </p>
              <button
                type="button"
                class="px-3 py-1.5 bg-surface-strong rounded-md text-13-medium hover:bg-surface-stronger disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={adapterReady() !== true}
                onClick={openBindDialog}
              >
                {language.t("settings.feishu.account.add")}
              </button>
            </div>
          }
        >
          <div class="flex flex-col gap-3">
            <For each={accounts() ?? []}>
              {(acc) => (
                <div class="bg-surface-base rounded-md p-3 flex items-center justify-between gap-3">
                  <div class="flex flex-col gap-0.5 min-w-0 flex-1">
                    <div class="flex items-center gap-2">
                      <span class="text-13-medium truncate">
                        {acc.bot_name?.trim() || acc.account_id}
                      </span>
                      <span class="text-11-regular text-text-weak">
                        {acc.domain === "feishu"
                          ? language.t("settings.feishu.bind.domain.feishu")
                          : language.t("settings.feishu.bind.domain.lark")}
                      </span>
                    </div>
                    <div class="flex items-center gap-3 text-11-regular text-text-weak">
                      <span class="truncate">openId: {maskOpenId(acc.open_id)}</span>
                      <span>agent: {acc.agent}</span>
                      <span>
                        {language.t("settings.feishu.account.modelLabel")}:{" "}
                        {acc.model
                          ? `${acc.model.provider_id}/${acc.model.model_id}`
                          : language.t("settings.feishu.account.modelDefault")}
                      </span>
                    </div>
                  </div>
                  <div class="flex items-center gap-1">
                    <button
                      type="button"
                      class="px-3 py-1 rounded-md text-12-medium hover:bg-surface-strong"
                      onClick={() => handleEdit(acc)}
                    >
                      {language.t("settings.feishu.account.edit")}
                    </button>
                    <button
                      type="button"
                      class="px-3 py-1 rounded-md text-12-medium text-text-warning hover:bg-surface-strong"
                      onClick={() => void handleDelete(acc.account_id)}
                    >
                      {language.t("settings.feishu.account.delete")}
                    </button>
                  </div>
                </div>
              )}
            </For>
            <button
              type="button"
              class="self-start px-3 py-1.5 bg-surface-strong rounded-md text-13-medium hover:bg-surface-stronger"
              onClick={openBindDialog}
            >
              {language.t("settings.feishu.account.add")}
            </button>
          </div>
        </Show>
      </Show>
    </div>
  )
}
