import { and, Database, eq, gte, inArray, isNull, lt, or, sql, sum } from "@opencode-ai/console-core/drizzle/index.js"
import { UsageTable } from "@opencode-ai/console-core/schema/billing.sql.js"
import { KeyTable } from "@opencode-ai/console-core/schema/key.sql.js"
import { UserTable } from "@opencode-ai/console-core/schema/user.sql.js"
import { AuthTable } from "@opencode-ai/console-core/schema/auth.sql.js"
import { useParams } from "@solidjs/router"
import { createEffect, createMemo, onCleanup, Show, For } from "solid-js"
import { createStore } from "solid-js/store"
import { withActor } from "~/context/auth.withActor"
import { Dropdown } from "~/component/dropdown"
import { IconChevronLeft, IconChevronRight } from "~/component/icon"
import styles from "./graph-section.module.css"
import {
  Chart,
  BarController,
  BarElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
  type ChartConfiguration,
} from "chart.js"
import { useI18n } from "~/context/i18n"

Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip, Legend)

async function getCosts(workspaceID: string, year: number, month: number, tzOffset: string) {
  "use server"
  return withActor(async () => {
    const timezoneOffset = (() => {
      const m = /^([+-])(\d{2}):(\d{2})$/.exec(tzOffset)
      if (!m) return 0
      const sign = m[1] === "-" ? -1 : 1
      return sign * (Number(m[2]) * 60 + Number(m[3])) * 60_000
    })()

    const monthStartUTC = new Date(Date.UTC(year, month, 1, 0, 0, 0) - timezoneOffset)
    const monthEndUTC = new Date(Date.UTC(year, month + 1, 1, 0, 0, 0) - timezoneOffset)
    const dateExpr = sql<string>`DATE(CONVERT_TZ(${UsageTable.timeCreated}, '+00:00', ${tzOffset}))`
    const usageData = await Database.use((tx) =>
      tx
        .select({
          date: dateExpr,
          model: UsageTable.model,
          totalCost: sum(UsageTable.cost),
          keyId: UsageTable.keyID,
          plan: sql<string | null>`JSON_EXTRACT(${UsageTable.enrichment}, '$.plan')`,
        })
        .from(UsageTable)
        .where(
          and(
            eq(UsageTable.workspaceID, workspaceID),
            gte(UsageTable.timeCreated, monthStartUTC),
            lt(UsageTable.timeCreated, monthEndUTC),
          ),
        )
        .groupBy(dateExpr, UsageTable.model, UsageTable.keyID, sql`JSON_EXTRACT(${UsageTable.enrichment}, '$.plan')`)
        .then((x) =>
          x.map((r) => ({
            ...r,
            totalCost: r.totalCost ? parseInt(r.totalCost) : 0,
            plan: r.plan as "sub" | "lite" | "byok" | null,
          })),
        ),
    )

    // Get unique key IDs from usage
    const usageKeyIds = new Set(usageData.map((r) => r.keyId).filter((id) => id !== null))

    // Second query: get all existing keys plus any keys from usage
    const keysData = await Database.use((tx) =>
      tx
        .select({
          keyId: KeyTable.id,
          keyName: KeyTable.name,
          userEmail: AuthTable.subject,
          timeDeleted: KeyTable.timeDeleted,
        })
        .from(KeyTable)
        .innerJoin(UserTable, and(eq(KeyTable.userID, UserTable.id), eq(KeyTable.workspaceID, UserTable.workspaceID)))
        .innerJoin(AuthTable, and(eq(UserTable.accountID, AuthTable.accountID), eq(AuthTable.provider, "email")))
        .where(
          and(
            eq(KeyTable.workspaceID, workspaceID),
            usageKeyIds.size > 0
              ? or(inArray(KeyTable.id, Array.from(usageKeyIds)), isNull(KeyTable.timeDeleted))
              : isNull(KeyTable.timeDeleted),
          ),
        )
        .orderBy(AuthTable.subject, KeyTable.name),
    )

    return {
      usage: usageData,
      keys: keysData.map((key) => ({
        id: key.keyId,
        displayName: `${key.userEmail} - ${key.keyName}`,
        deleted: key.timeDeleted !== null,
      })),
    }
  }, workspaceID)
}

const MODEL_COLORS: Record<string, string> = {
  "claude-sonnet-4-5": "#D4745C",
  "claude-sonnet-4": "#E8B4A4",
  "claude-opus-4": "#C8A098",
  "claude-haiku-4-5": "#F0D8D0",
  "claude-3-5-haiku": "#F8E8E0",
  "gpt-5.1": "#4A90E2",
  "gpt-5.1-codex": "#6BA8F0",
  "gpt-5": "#7DB8F8",
  "gpt-5-codex": "#9FCAFF",
  "gpt-5-nano": "#B8D8FF",
  "grok-code": "#8B5CF6",
  "big-pickle": "#10B981",
  "kimi-k2": "#F59E0B",
  "qwen3-coder": "#EC4899",
  "glm-4.6": "#14B8A6",
}

function getModelColor(model: string): string {
  if (MODEL_COLORS[model]) return MODEL_COLORS[model]

  const hash = model.split("").reduce((acc, char) => char.charCodeAt(0) + ((acc << 5) - acc), 0)
  const hue = Math.abs(hash) % 360
  return `hsl(${hue}, 50%, 65%)`
}

function formatDateLabel(dateStr: string): string {
  const [, m, d] = dateStr.split("-").map(Number)
  const month = new Date(2000, m - 1, 1).toLocaleDateString(undefined, { month: "short" })
  return `${month} ${d.toString().padStart(2, "0")}`
}

// Compute the UTC offset (in MySQL CONVERT_TZ format like "+05:30") for the
// given IANA timezone at the given instant. Honors DST.
function getTimezoneOffset(timezone: string, at: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
    .formatToParts(at)
    .reduce<Record<string, string>>((acc, p) => {
      if (p.type !== "literal") acc[p.type] = p.value
      return acc
    }, {})
  const asUTC = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  )
  const diffMinutes = Math.round((asUTC - at.getTime()) / 60_000)
  const sign = diffMinutes < 0 ? "-" : "+"
  const abs = Math.abs(diffMinutes)
  const hh = Math.floor(abs / 60)
    .toString()
    .padStart(2, "0")
  const mm = (abs % 60).toString().padStart(2, "0")
  return `${sign}${hh}:${mm}`
}

function addOpacityToColor(color: string, opacity: number): string {
  if (color.startsWith("#")) {
    const r = parseInt(color.slice(1, 3), 16)
    const g = parseInt(color.slice(3, 5), 16)
    const b = parseInt(color.slice(5, 7), 16)
    return `rgba(${r}, ${g}, ${b}, ${opacity})`
  }
  if (color.startsWith("hsl")) return color.replace(")", `, ${opacity})`).replace("hsl", "hsla")
  return color
}

export function GraphSection() {
  let canvasRef: HTMLCanvasElement | undefined
  let chartInstance: Chart | undefined
  const params = useParams()
  const i18n = useI18n()
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const now = new Date()
  const [store, setStore] = createStore({
    data: null as Awaited<ReturnType<typeof getCosts>> | null,
    year: now.getFullYear(),
    month: now.getMonth(),
    key: null as string | null,
    model: null as string | null,
    modelDropdownOpen: false,
    keyDropdownOpen: false,
    colorScheme: "light" as "light" | "dark",
  })
  const onPreviousMonth = async () => {
    const month = store.month === 0 ? 11 : store.month - 1
    const year = store.month === 0 ? store.year - 1 : store.year
    setStore({ month, year })
  }

  const onNextMonth = async () => {
    const month = store.month === 11 ? 0 : store.month + 1
    const year = store.month === 11 ? store.year + 1 : store.year
    setStore({ month, year })
  }

  const onSelectModel = (model: string | null) => setStore({ model, modelDropdownOpen: false })

  const onSelectKey = (keyID: string | null) => setStore({ key: keyID, keyDropdownOpen: false })

  const getModels = createMemo(() => {
    if (!store.data?.usage) return []
    return Array.from(new Set(store.data.usage.map((row) => row.model))).sort()
  })

  const getDates = createMemo(() => {
    // Number of days in the month is independent of timezone.
    const daysInMonth = new Date(Date.UTC(store.year, store.month + 1, 0)).getUTCDate()
    const yyyy = store.year.toString().padStart(4, "0")
    const mm = (store.month + 1).toString().padStart(2, "0")
    return Array.from({ length: daysInMonth }, (_, i) => {
      const dd = (i + 1).toString().padStart(2, "0")
      return `${yyyy}-${mm}-${dd}`
    })
  })

  const getKeyName = (keyID: string | null): string => {
    if (!keyID || !store.data?.keys) return i18n.t("workspace.cost.allKeys")
    const found = store.data.keys.find((k) => k.id === keyID)
    if (!found) return i18n.t("workspace.cost.allKeys")
    return found.deleted ? `${found.displayName} ${i18n.t("workspace.cost.deletedSuffix")}` : found.displayName
  }

  const formatMonthYear = () =>
    new Date(store.year, store.month, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" })

  const isCurrentMonth = () => store.year === now.getFullYear() && store.month === now.getMonth()

  const chartConfig = createMemo((): ChartConfiguration | null => {
    const data = store.data
    const dates = getDates()
    if (!data?.usage?.length) return null

    store.colorScheme
    const styles = getComputedStyle(document.documentElement)
    const colorTextMuted = styles.getPropertyValue("--color-text-muted").trim()
    const colorBorderMuted = styles.getPropertyValue("--color-border-muted").trim()
    const colorBgElevated = styles.getPropertyValue("--color-bg-elevated").trim()
    const colorText = styles.getPropertyValue("--color-text").trim()
    const colorTextSecondary = styles.getPropertyValue("--color-text-secondary").trim()
    const colorBorder = styles.getPropertyValue("--color-border").trim()
    const subSuffix = ` (${i18n.t("workspace.cost.subscriptionShort")})`
    const liteSuffix = " (go)"

    const dailyDataRegular = new Map<string, Map<string, number>>()
    const dailyDataSub = new Map<string, Map<string, number>>()
    const dailyDataLite = new Map<string, Map<string, number>>()
    for (const dateKey of dates) {
      dailyDataRegular.set(dateKey, new Map())
      dailyDataSub.set(dateKey, new Map())
      dailyDataLite.set(dateKey, new Map())
    }

    data.usage
      .filter((row) => (store.key ? row.keyId === store.key : true))
      .forEach((row) => {
        const targetMap = row.plan === "sub" ? dailyDataSub : row.plan === "lite" ? dailyDataLite : dailyDataRegular
        const dayMap = targetMap.get(row.date)
        if (!dayMap) return
        dayMap.set(row.model, (dayMap.get(row.model) ?? 0) + row.totalCost)
      })

    const filteredModels = store.model === null ? getModels() : [store.model]

    // Create datasets: regular first, then subscription, then lite (with visual distinction via opacity)
    const datasets = [
      ...filteredModels
        .filter((model) => dates.some((date) => (dailyDataRegular.get(date)?.get(model) || 0) > 0))
        .map((model) => {
          const color = getModelColor(model)
          return {
            label: model,
            data: dates.map((date) => (dailyDataRegular.get(date)?.get(model) || 0) / 100_000_000),
            backgroundColor: color,
            hoverBackgroundColor: color,
            borderWidth: 0,
            stack: "usage",
          }
        }),
      ...filteredModels
        .filter((model) => dates.some((date) => (dailyDataSub.get(date)?.get(model) || 0) > 0))
        .map((model) => {
          const color = getModelColor(model)
          return {
            label: `${model}${subSuffix}`,
            data: dates.map((date) => (dailyDataSub.get(date)?.get(model) || 0) / 100_000_000),
            backgroundColor: addOpacityToColor(color, 0.5),
            hoverBackgroundColor: addOpacityToColor(color, 0.7),
            borderWidth: 1,
            borderColor: color,
            stack: "subscription",
          }
        }),
      ...filteredModels
        .filter((model) => dates.some((date) => (dailyDataLite.get(date)?.get(model) || 0) > 0))
        .map((model) => {
          const color = getModelColor(model)
          return {
            label: `${model}${liteSuffix}`,
            data: dates.map((date) => (dailyDataLite.get(date)?.get(model) || 0) / 100_000_000),
            backgroundColor: addOpacityToColor(color, 0.35),
            hoverBackgroundColor: addOpacityToColor(color, 0.55),
            borderWidth: 1,
            borderColor: addOpacityToColor(color, 0.7),
            borderDash: [4, 2],
            stack: "lite",
          }
        }),
    ]

    return {
      type: "bar",
      data: {
        labels: dates.map(formatDateLabel),
        datasets,
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            stacked: true,
            grid: {
              display: false,
            },
            ticks: {
              maxRotation: 0,
              autoSkipPadding: 20,
              color: colorTextMuted,
              font: {
                family: "monospace",
                size: 11,
              },
            },
          },
          y: {
            stacked: true,
            beginAtZero: true,
            grid: {
              color: colorBorderMuted,
            },
            ticks: {
              color: colorTextMuted,
              font: {
                family: "monospace",
                size: 11,
              },
              callback: (value) => {
                const num = Number(value)
                return num >= 1000 ? `$${(num / 1000).toFixed(1)}k` : `$${num.toFixed(0)}`
              },
            },
          },
        },
        plugins: {
          tooltip: {
            mode: "index",
            intersect: false,
            backgroundColor: colorBgElevated,
            titleColor: colorText,
            bodyColor: colorTextSecondary,
            borderColor: colorBorder,
            borderWidth: 1,
            padding: 12,
            displayColors: true,
            filter: (item) => (item.parsed.y ?? 0) > 0,
            callbacks: {
              label: (context) => `${context.dataset.label}: $${(context.parsed.y ?? 0).toFixed(2)}`,
            },
          },
          legend: {
            display: true,
            position: "bottom",
            labels: {
              color: colorTextSecondary,
              font: {
                size: 12,
              },
              padding: 16,
              boxWidth: 16,
              boxHeight: 16,
              usePointStyle: false,
            },
            onHover: (event, legendItem, legend) => {
              const chart = legend.chart
              chart.data.datasets?.forEach((dataset, i) => {
                const meta = chart.getDatasetMeta(i)
                const label = dataset.label || ""
                const isSub = label.endsWith(subSuffix)
                const isLite = label.endsWith(liteSuffix)
                const model = isSub
                  ? label.slice(0, -subSuffix.length)
                  : isLite
                    ? label.slice(0, -liteSuffix.length)
                    : label
                const baseColor = getModelColor(model)
                const originalColor = isSub
                  ? addOpacityToColor(baseColor, 0.5)
                  : isLite
                    ? addOpacityToColor(baseColor, 0.35)
                    : baseColor
                const color = i === legendItem.datasetIndex ? originalColor : addOpacityToColor(baseColor, 0.15)
                meta.data.forEach((bar: any) => {
                  bar.options.backgroundColor = color
                })
              })
              chart.update("none")
            },
            onLeave: (event, legendItem, legend) => {
              const chart = legend.chart
              chart.data.datasets?.forEach((dataset, i) => {
                const meta = chart.getDatasetMeta(i)
                const label = dataset.label || ""
                const isSub = label.endsWith(subSuffix)
                const isLite = label.endsWith(liteSuffix)
                const model = isSub
                  ? label.slice(0, -subSuffix.length)
                  : isLite
                    ? label.slice(0, -liteSuffix.length)
                    : label
                const baseColor = getModelColor(model)
                const color = isSub
                  ? addOpacityToColor(baseColor, 0.5)
                  : isLite
                    ? addOpacityToColor(baseColor, 0.35)
                    : baseColor
                meta.data.forEach((bar: any) => {
                  bar.options.backgroundColor = color
                })
              })
              chart.update("none")
            },
          },
        },
      },
    }
  })

  createEffect(async () => {
    // Compute the offset for mid-month so DST transitions don't bias to the
    // wrong side.
    const midMonth = new Date(Date.UTC(store.year, store.month, 15, 12, 0, 0))
    const tzOffset = getTimezoneOffset(timezone, midMonth)
    const data = await getCosts(params.id!, store.year, store.month, tzOffset)
    setStore({ data })
  })

  createEffect(() => {
    const config = chartConfig()
    if (!config || !canvasRef) return

    if (chartInstance) chartInstance.destroy()
    chartInstance = new Chart(canvasRef, config)

    onCleanup(() => chartInstance?.destroy())
  })

  createEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)")
    setStore({ colorScheme: mediaQuery.matches ? "dark" : "light" })

    const handleColorSchemeChange = (e: MediaQueryListEvent) => {
      setStore({ colorScheme: e.matches ? "dark" : "light" })
    }

    mediaQuery.addEventListener("change", handleColorSchemeChange)
    onCleanup(() => mediaQuery.removeEventListener("change", handleColorSchemeChange))
  })

  return (
    <section class={styles.root}>
      <div data-slot="section-title">
        <h2>{i18n.t("workspace.cost.title")}</h2>
        <p>{i18n.t("workspace.cost.subtitle")}</p>
      </div>

      <div data-slot="filter-container">
        <div data-slot="month-picker">
          <button data-slot="month-button" onClick={onPreviousMonth}>
            <IconChevronLeft />
          </button>
          <span data-slot="month-label">{formatMonthYear()}</span>
          <button data-slot="month-button" onClick={onNextMonth} disabled={isCurrentMonth()}>
            <IconChevronRight />
          </button>
        </div>
        <Dropdown
          trigger={store.model === null ? i18n.t("workspace.cost.allModels") : store.model}
          open={store.modelDropdownOpen}
          onOpenChange={(open) => setStore({ modelDropdownOpen: open })}
        >
          <>
            <button data-slot="model-item" onClick={() => onSelectModel(null)}>
              <span>{i18n.t("workspace.cost.allModels")}</span>
            </button>
            <For each={getModels()}>
              {(model) => (
                <button data-slot="model-item" onClick={() => onSelectModel(model)}>
                  <span>{model}</span>
                </button>
              )}
            </For>
          </>
        </Dropdown>
        <Dropdown
          trigger={getKeyName(store.key)}
          open={store.keyDropdownOpen}
          onOpenChange={(open) => setStore({ keyDropdownOpen: open })}
        >
          <>
            <button data-slot="model-item" onClick={() => onSelectKey(null)}>
              <span>{i18n.t("workspace.cost.allKeys")}</span>
            </button>
            <For each={store.data?.keys || []}>
              {(key) => (
                <button data-slot="model-item" onClick={() => onSelectKey(key.id)}>
                  <span>
                    {key.deleted ? `${key.displayName} ${i18n.t("workspace.cost.deletedSuffix")}` : key.displayName}
                  </span>
                </button>
              )}
            </For>
          </>
        </Dropdown>
      </div>

      <Show
        when={chartConfig()}
        fallback={
          <div data-component="empty-state">
            <p>{i18n.t("workspace.cost.empty")}</p>
          </div>
        }
      >
        <div data-slot="chart-container">
          <canvas ref={canvasRef} />
        </div>
      </Show>
    </section>
  )
}
