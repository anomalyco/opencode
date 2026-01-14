import { and, Database, eq, gte, inArray, isNull, lte, or, sql, sum } from "@opencode-ai/console-core/drizzle/index.js"
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

Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip, Legend)

async function getCosts(workspaceID: string, year: number, month: number) {
  "use server"
  return withActor(async () => {
    const startDate = new Date(year, month, 1)
    const endDate = new Date(year, month + 1, 0)

    // First query: get usage data without joining keys
    const usageData = await Database.use((tx) =>
      tx
        .select({
          date: sql<string>`DATE(${UsageTable.timeCreated})`,
          model: UsageTable.model,
          totalCost: sum(UsageTable.cost),
          keyId: UsageTable.keyID,
        })
        .from(UsageTable)
        .where(
          and(
            eq(UsageTable.workspaceID, workspaceID),
            gte(UsageTable.timeCreated, startDate),
            lte(UsageTable.timeCreated, endDate),
            or(isNull(UsageTable.enrichment), sql`JSON_EXTRACT(${UsageTable.enrichment}, '$.plan') != 'sub'`),
          ),
        )
        .groupBy(sql`DATE(${UsageTable.timeCreated})`, UsageTable.model, UsageTable.keyID)
        .then((x) =>
          x.map((r) => ({
            ...r,
            totalCost: r.totalCost ? parseInt(r.totalCost) : 0,
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
        displayName:
          key.timeDeleted !== null
            ? `${key.userEmail} - ${key.keyName} (deleted)`
            : `${key.userEmail} - ${key.keyName}`,
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
  const date = new Date()
  const [y, m, d] = dateStr.split("-").map(Number)
  date.setFullYear(y)
  date.setMonth(m - 1)
  date.setDate(d)
  date.setHours(0, 0, 0, 0)
  const month = date.toLocaleDateString("en-US", { month: "short" })
  const day = date.getUTCDate().toString().padStart(2, "0")
  return `${month} ${day}`
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
    const daysInMonth = new Date(store.year, store.month + 1, 0).getDate()
    return Array.from({ length: daysInMonth }, (_, i) => {
      const date = new Date(store.year, store.month, i + 1)
      return date.toISOString().split("T")[0]
    })
  })

  const getKeyName = (keyID: string | null): string => {
    if (!keyID || !store.data?.keys) return "All Keys"
    const found = store.data.keys.find((k) => k.id === keyID)
    return found?.displayName ?? "All Keys"
  }

  const formatMonthYear = () =>
    new Date(store.year, store.month, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" })

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

    const dailyData = new Map<string, Map<string, number>>()
    for (const dateKey of dates) dailyData.set(dateKey, new Map())

    data.usage
      .filter((row) => (store.key ? row.keyId === store.key : true))
      .forEach((row) => {
        const dayMap = dailyData.get(row.date)
        if (!dayMap) return
        dayMap.set(row.model, (dayMap.get(row.model) ?? 0) + row.totalCost)
      })

    const filteredModels = store.model === null ? getModels() : [store.model]

    const datasets = filteredModels.map((model) => {
      const color = getModelColor(model)
      return {
        label: model,
        data: dates.map((date) => (dailyData.get(date)?.get(model) || 0) / 100_000_000),
        backgroundColor: color,
        hoverBackgroundColor: color,
        borderWidth: 0,
      }
    })

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
            callbacks: {
              label: (context) => {
                const value = context.parsed.y
                if (!value || value === 0) return
                return `${context.dataset.label}: $${value.toFixed(2)}`
              },
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
                const baseColor = getModelColor(dataset.label || "")
                const color = i === legendItem.datasetIndex ? baseColor : addOpacityToColor(baseColor, 0.3)
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
                const baseColor = getModelColor(dataset.label || "")
                meta.data.forEach((bar: any) => {
                  bar.options.backgroundColor = baseColor
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
    const data = await getCosts(params.id!, store.year, store.month)
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
        <h2>Cost</h2>
        <p>Usage costs broken down by model.</p>
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
          trigger={store.model === null ? "All Models" : store.model}
          open={store.modelDropdownOpen}
          onOpenChange={(open) => setStore({ modelDropdownOpen: open })}
        >
          <>
            <button data-slot="model-item" onClick={() => onSelectModel(null)}>
              <span>All Models</span>
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
              <span>All Keys</span>
            </button>
            <For each={store.data?.keys || []}>
              {(key) => (
                <button data-slot="model-item" onClick={() => onSelectKey(key.id)}>
                  <span>{key.displayName}</span>
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
            <p>No usage data available for the selected period.</p>
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
