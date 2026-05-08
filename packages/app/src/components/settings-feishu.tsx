// FORK: 飞书桥接 Settings Tab(C1.4)— 账户管理 v1 占位 [feat: feishu-bridge] 2026-05-08
//
// v1 范围(本 commit C1.4):
//   - 标题 + 描述
//   - adapter ready 状态检查 + 未就绪提示
//   - "尚未绑定" 空态 + "添加飞书账号" 按钮
//   - 真扫码弹窗在 C1.5 接入
//
// 后续(Phase 3+):已绑定账号列表 + 删除 + 群组配置 + 健康检查子 Tab

import { type Component, createSignal, onMount, Show } from "solid-js"
import { invoke } from "@tauri-apps/api/core"
import { useLanguage } from "@/context/language"

export const SettingsFeishu: Component = () => {
  const language = useLanguage()
  const [adapterReady, setAdapterReady] = createSignal<boolean | null>(null)

  onMount(async () => {
    try {
      const ready = await invoke<boolean>("feishu_adapter_status")
      setAdapterReady(ready)
    } catch {
      setAdapterReady(false)
    }
  })

  return (
    <div class="flex flex-col gap-6 p-4 max-w-2xl">
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

      {/* 账户列表区:v1 占位"尚未绑定"空态 */}
      <Show when={adapterReady() !== false}>
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
            onClick={() => {
              // TODO C1.5:打开扫码弹窗
              console.log("[feishu-bridge] add account clicked — C1.5 will wire up bind dialog")
            }}
          >
            {language.t("settings.feishu.account.add")}
          </button>
        </div>
      </Show>
    </div>
  )
}
