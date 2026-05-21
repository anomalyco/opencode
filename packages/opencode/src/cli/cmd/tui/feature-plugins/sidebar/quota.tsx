import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { Show } from "solid-js"
import { useQuota } from "../../context/quota"
import { dailyResetInfo, monthlyResetInfo } from "@opencode-ai/anr-core"

const id = "internal:sidebar-quota"

function getQuotaColor(percent: number): "green" | "yellow" | "red" {
  if (percent >= 90) return "red"
  if (percent >= 80) return "yellow"
  return "green"
}

function colorMap(color: "green" | "yellow" | "red", theme: Record<string, any>) {
  return ({ green: theme.success, yellow: theme.warning, red: theme.error })[color]
}

const tui: TuiPlugin = async (api) => {
  // Only register if in ANR mode
  if (process.env.OPENCODE_FLAVOR !== "anr") return

  api.slots.register({
    order: 150, // After context (100) but before MCP (200)
    slots: {
      sidebar_content(_ctx, _props) {
        const quota = useQuota()
        const theme = () => api.theme.current

        return (
          <Show when={quota.dailyLimit > 0 || quota.monthlyLimit > 0}>
            <box>
              <text fg={theme().text}>
                <b>Quota</b>
              </text>
              <Show when={quota.dailyLimit > 0}>
                <box gap={0.25}>
                  <box flexDirection="row" alignItems="center" gap={1}>
                    <text fg={colorMap(getQuotaColor(quota.effectiveDailyPercent), theme())}>
                      Daily: {quota.effectiveDailyPercent}%
                    </text>
                    <box width={20} height={1} backgroundColor={theme().backgroundElement}>
                      <box
                        width={Math.max(1, Math.round((quota.effectiveDailyPercent / 100) * 20))}
                        height={1}
                        backgroundColor={colorMap(getQuotaColor(quota.effectiveDailyPercent), theme())}
                      />
                    </box>
                  </box>
                  <text fg={theme().textMuted}>
                    {quota.effectiveDailyTokens.toLocaleString()} / {quota.dailyLimit.toLocaleString()} tokens
                  </text>
                </box>
              </Show>
              <Show when={quota.monthlyLimit > 0}>
                <box gap={0.25} marginTop={0.5}>
                  <box flexDirection="row" alignItems="center" gap={1}>
                    <text fg={colorMap(getQuotaColor(quota.effectiveMonthlyPercent), theme())}>
                      Monthly: {quota.effectiveMonthlyPercent}%
                    </text>
                    <box width={20} height={1} backgroundColor={theme().backgroundElement}>
                      <box
                        width={Math.max(1, Math.round((quota.effectiveMonthlyPercent / 100) * 20))}
                        height={1}
                        backgroundColor={colorMap(getQuotaColor(quota.effectiveMonthlyPercent), theme())}
                      />
                    </box>
                  </box>
                  <text fg={theme().textMuted}>
                    {quota.effectiveMonthlyTokens.toLocaleString()} / {quota.monthlyLimit.toLocaleString()} tokens
                  </text>
                </box>
              </Show>
              <Show when={quota.effectiveWarningLevel === "warning"}>
                <text fg={theme().warning}>⚠️ Approaching quota limit</text>
              </Show>
              <Show when={quota.effectiveWarningLevel === "critical" && Math.max(quota.effectiveDailyPercent, quota.effectiveMonthlyPercent) < 100}>
                <text fg={theme().error}>⚠️ Nearing quota limit</text>
              </Show>
              <Show when={Math.max(quota.effectiveDailyPercent, quota.effectiveMonthlyPercent) >= 100}>
                <text fg={theme().error}>🚫 Quota exceeded</text>
                <Show when={quota.effectiveDailyPercent >= 100}>
                  <text fg={theme().textMuted}>   {dailyResetInfo()}</text>
                </Show>
                <Show when={quota.effectiveMonthlyPercent >= 100}>
                  <text fg={theme().textMuted}>   {monthlyResetInfo()}</text>
                </Show>
                <text fg={theme().textMuted}>   Contact your administrator for limit increases.</text>
              </Show>
            </box>
          </Show>
        )
      },
    },
  })
}

const plugin: TuiPluginModule & { id: string } = {
  id,
  tui,
}

export default plugin
