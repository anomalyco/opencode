// @ts-nocheck
import { createSignal, onCleanup, For } from "solid-js"
import { AnimatedCountList, type CountItem } from "./tool-count-summary"
import { ToolStatusTitle } from "./tool-status-title"

export default {
  title: "UI/AnimatedCountList",
  id: "components-animated-count-list",
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component: `### Overview
Animated count list that smoothly transitions items in/out as counts change.

Uses \`grid-template-columns: 0fr → 1fr\` for width animations and the odometer
digit roller for count transitions. Shown here with \`ToolStatusTitle\` exactly
as it appears in the context tool group on the session page.`,
      },
    },
  },
}

const LOCALES = {
  en: {
    label: "English",
    active: "Exploring",
    done: "Explored",
    read: { one: "{{count}} read", other: "{{count}} reads" },
    search: { one: "{{count}} search", other: "{{count}} searches" },
    list: { one: "{{count}} list", other: "{{count}} lists" },
  },
  fr: {
    label: "Français",
    active: "Exploration",
    done: "Exploré",
    read: { one: "{{count}} lecture", other: "{{count}} lectures" },
    search: { one: "{{count}} recherche", other: "{{count}} recherches" },
    list: { one: "{{count}} liste", other: "{{count}} listes" },
  },
  ja: {
    label: "日本語",
    active: "探索中",
    done: "探索済み",
    read: { one: "{{count}} 件の読み取り", other: "{{count}} 件の読み取り" },
    search: { one: "{{count}} 件の検索", other: "{{count}} 件の検索" },
    list: { one: "{{count}} 件のリスト", other: "{{count}} 件のリスト" },
  },
  ko: {
    label: "한국어",
    active: "탐색 중",
    done: "탐색됨",
    read: { one: "{{count}}개 읽음", other: "{{count}}개 읽음" },
    search: { one: "{{count}}개 검색", other: "{{count}}개 검색" },
    list: { one: "{{count}}개 목록", other: "{{count}}개 목록" },
  },
  de: {
    label: "Deutsch",
    active: "Erkunden",
    done: "Erkundet",
    read: { one: "{{count}} Lesevorgang", other: "{{count}} Lesevorgänge" },
    search: { one: "{{count}} Suche", other: "{{count}} Suchen" },
    list: { one: "{{count}} Liste", other: "{{count}} Listen" },
  },
  es: {
    label: "Español",
    active: "Explorando",
    done: "Explorado",
    read: { one: "{{count}} lectura", other: "{{count}} lecturas" },
    search: { one: "{{count}} búsqueda", other: "{{count}} búsquedas" },
    list: { one: "{{count}} lista", other: "{{count}} listas" },
  },
  th: {
    label: "ไทย",
    active: "กำลังสำรวจ",
    done: "สำรวจแล้ว",
    read: { one: "อ่าน {{count}} รายการ", other: "อ่าน {{count}} รายการ" },
    search: { one: "ค้นหา {{count}} รายการ", other: "ค้นหา {{count}} รายการ" },
    list: { one: "รายการ {{count}} รายการ", other: "รายการ {{count}} รายการ" },
  },
  ar: {
    label: "العربية",
    active: "استكشاف",
    done: "تم الاستكشاف",
    read: { one: "{{count}} قراءة", other: "{{count}} قراءات" },
    search: { one: "{{count}} بحث", other: "{{count}} عمليات بحث" },
    list: { one: "{{count}} قائمة", other: "{{count}} قوائم" },
  },
} as const

type LocaleKey = keyof typeof LOCALES

function rand(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

const btn = (accent?: boolean) =>
  ({
    padding: "6px 14px",
    "border-radius": "6px",
    border: "1px solid var(--color-divider, #333)",
    background: accent ? "var(--color-danger-fill, #c33)" : "var(--color-fill-element, #222)",
    color: "var(--color-text, #eee)",
    cursor: "pointer",
    "font-size": "13px",
  }) as const

const smallBtn = (active?: boolean) =>
  ({
    padding: "4px 12px",
    "border-radius": "6px",
    border: active ? "1px solid var(--color-accent, #58f)" : "1px solid var(--color-divider, #333)",
    background: active ? "var(--color-accent, #58f)" : "var(--color-fill-element, #222)",
    color: "var(--color-text, #eee)",
    cursor: "pointer",
    "font-size": "12px",
  }) as const

export const Playground = {
  render: () => {
    const [reads, setReads] = createSignal(0)
    const [searches, setSearches] = createSignal(0)
    const [lists, setLists] = createSignal(0)
    const [active, setActive] = createSignal(false)
    const [locale, setLocale] = createSignal<LocaleKey>("en")
    const [reducedMotion, setReducedMotion] = createSignal(false)

    const l = () => LOCALES[locale()]

    let timeouts: ReturnType<typeof setTimeout>[] = []

    const clearAll = () => {
      for (const t of timeouts) clearTimeout(t)
      timeouts = []
    }

    onCleanup(clearAll)

    const startSim = () => {
      clearAll()
      setReads(0)
      setSearches(0)
      setLists(0)
      setActive(true)
      const steps = rand(3, 10)
      let elapsed = 0

      for (let i = 0; i < steps; i++) {
        const delay = rand(300, 800)
        elapsed += delay
        const t = setTimeout(() => {
          const pick = rand(0, 2)
          if (pick === 0) setReads((n) => n + 1)
          else if (pick === 1) setSearches((n) => n + 1)
          else setLists((n) => n + 1)
        }, elapsed)
        timeouts.push(t)
      }

      const end = setTimeout(() => setActive(false), elapsed + 100)
      timeouts.push(end)
    }

    const stopSim = () => {
      clearAll()
      setActive(false)
    }

    const reset = () => {
      stopSim()
      setReads(0)
      setSearches(0)
      setLists(0)
    }

    const items = (): CountItem[] => [
      { key: "read", count: reads(), one: l().read.one, other: l().read.other },
      { key: "search", count: searches(), one: l().search.one, other: l().search.other },
      { key: "list", count: lists(), one: l().list.one, other: l().list.other },
    ]

    return (
      <div style={{ display: "grid", gap: "24px", padding: "20px", "max-width": "520px" }}>
        {reducedMotion() && (
          <style>
            {`[data-reduced-motion="true"] *,
              [data-reduced-motion="true"] *::before,
              [data-reduced-motion="true"] *::after {
                transition-duration: 0ms !important;
              }`}
          </style>
        )}

        {/* Matches context-tool-group-trigger layout from message-part.tsx */}
        <span
          data-reduced-motion={reducedMotion()}
          style={{
            display: "flex",
            "align-items": "center",
            gap: "8px",
            "font-size": "14px",
            "font-weight": "500",
            color: "var(--text-strong, #eee)",
            "min-width": "0",
          }}
        >
          <span style={{ "flex-shrink": "0" }}>
            <ToolStatusTitle active={active()} activeText={l().active} doneText={l().done} split={false} />
          </span>
          <span
            style={{
              "min-width": "0",
              overflow: "hidden",
              "text-overflow": "ellipsis",
              "white-space": "nowrap",
              "font-weight": "400",
              color: "var(--text-base, #ccc)",
            }}
          >
            <AnimatedCountList items={items()} fallback="" />
          </span>
        </span>

        {/* Language picker */}
        <div style={{ display: "flex", gap: "6px", "flex-wrap": "wrap" }}>
          <For each={Object.keys(LOCALES) as LocaleKey[]}>
            {(key) => (
              <button onClick={() => setLocale(key)} style={smallBtn(locale() === key)}>
                {LOCALES[key].label}
              </button>
            )}
          </For>
        </div>

        <div style={{ display: "flex", gap: "8px", "flex-wrap": "wrap" }}>
          <button onClick={() => (active() ? stopSim() : startSim())} style={btn(active())}>
            {active() ? "Stop" : "Simulate"}
          </button>
          <button onClick={reset} style={btn()}>
            Reset
          </button>
          <button onClick={() => setReducedMotion((v) => !v)} style={smallBtn(reducedMotion())}>
            {reducedMotion() ? "Motion: reduced" : "Motion: normal"}
          </button>
        </div>

        <div style={{ display: "flex", gap: "8px", "flex-wrap": "wrap" }}>
          <button onClick={() => setReads((n) => n + 1)} style={smallBtn()}>
            + read
          </button>
          <button onClick={() => setSearches((n) => n + 1)} style={smallBtn()}>
            + search
          </button>
          <button onClick={() => setLists((n) => n + 1)} style={smallBtn()}>
            + list
          </button>
        </div>

        <div
          style={{
            "font-size": "11px",
            color: "var(--color-text-weak, #888)",
            "font-family": "monospace",
          }}
        >
          {locale()} · motion: {reducedMotion() ? "reduced" : "normal"} · active: {active() ? "true" : "false"} · reads:{" "}
          {reads()} · searches: {searches()} · lists: {lists()}
        </div>
      </div>
    )
  },
}

export const Empty = {
  render: () => (
    <span style={{ display: "flex", "align-items": "center", gap: "8px", "font-size": "14px", "font-weight": "500" }}>
      <ToolStatusTitle active activeText="Exploring" doneText="Explored" split={false} />
      <AnimatedCountList
        items={[
          { key: "read", count: 0, one: "{{count}} read", other: "{{count}} reads" },
          { key: "search", count: 0, one: "{{count}} search", other: "{{count}} searches" },
        ]}
        fallback=""
      />
    </span>
  ),
}

export const Done = {
  render: () => (
    <span style={{ display: "flex", "align-items": "center", gap: "8px", "font-size": "14px", "font-weight": "500" }}>
      <ToolStatusTitle active={false} activeText="Exploring" doneText="Explored" split={false} />
      <span style={{ "font-weight": "400", color: "var(--text-base, #ccc)" }}>
        <AnimatedCountList
          items={[
            { key: "read", count: 5, one: "{{count}} read", other: "{{count}} reads" },
            { key: "search", count: 3, one: "{{count}} search", other: "{{count}} searches" },
            { key: "list", count: 1, one: "{{count}} list", other: "{{count}} lists" },
          ]}
          fallback=""
        />
      </span>
    </span>
  ),
}
