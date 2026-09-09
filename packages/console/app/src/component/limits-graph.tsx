import { For, createSignal, onCleanup, onMount } from "solid-js"
import { useI18n } from "~/context/i18n"

export function LimitsGraph(props: { href: string }) {
  let root!: HTMLElement
  const [visible, setVisible] = createSignal(false)

  const i18n = useI18n()

  onMount(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)")
    const finish = () => {
      if (!motion.matches) return
      setVisible(true)
    }
    motion.addEventListener("change", finish)
    onCleanup(() => {
      motion.removeEventListener("change", finish)
    })
    if (motion.matches) return finish()
    if (typeof IntersectionObserver === "undefined") return setVisible(true)
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        if (!entry?.isIntersecting || entry.intersectionRatio < 0.35) return
        setVisible(true)
        observer.disconnect()
      },
      { threshold: 0.35 },
    )
    observer.observe(root)
    onCleanup(() => observer.disconnect())
  })

  const baseline = 100
  const graph = [
    { id: "kimi-k3", name: "Kimi K3", req: 110 },
    { id: "grok-4.6", name: "Grok 4.6", req: 169 },
    { id: "hy4-preview", name: "Hy4 preview", req: 1350 },
    { id: "gpt-5.6-luna", name: "GPT 5.6 Luna", req: 2050 },
    { id: "minimax-m3", name: "MiniMax M3", req: 3200 },
    { id: "qwen3.7-plus", name: "Qwen3.7 Plus", req: 4300 },
    { id: "hy3", name: "Hy3", req: 4300 },
    { id: "qwen3.8-flash", name: "Qwen3.8 Flash", req: 5400 },
    { id: "glm-5.3-flash", name: "GLM-5.3-Flash", req: 6320 },
    { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash", req: 7600 },
    { id: "longcat-2.0", name: "LongCat-2.0", req: 11400 },
    { id: "omen-alpha", name: "Omen Alpha", req: 11600 },
    { id: "mimo-v2.5", name: "MiMo-V2.5", req: 30100 },
    { id: "muse-spark-1.3-contributor", name: "Muse Spark 1.3 Contributor", req: 45300, edge: true },
  ].map((model, index) => ({ ...model, d: `${50 + index * 25}ms` }))

  const w = 1040
  const chartW = 720
  const left = 40
  const right = 60
  const top = 18
  const bottom = 44
  const plot = chartW - left - right
  const infiniteX = w - 180

  const ratio = (n: number) => n / baseline
  const rmax = Math.max(1, ...graph.filter((m) => !("infinite" in m)).map((m) => ratio(m.req)))
  const log = (n: number) => Math.log10(Math.max(n, 1))
  const base = 24
  const p = 2.2
  const x = (r: number) => left + base + Math.pow(log(r) / log(rmax), p) * (plot - base)
  const ticks = [1, 5, 10, 25, 50, 100, 250].filter((t) => t <= rmax)
  const labels = (() => {
    const set = new Set<number>()
    let last = -Infinity
    for (const t of ticks) {
      if (t === 1) {
        set.add(t)
        last = x(t)
        continue
      }
      const pos = x(t)
      if (pos - last < 44) continue
      set.add(t)
      last = pos
    }
    return set
  })()
  const shown = ticks.filter((t) => labels.has(t))
  const bh = 8
  const gap = 20
  const step = bh + gap
  const gy = (i: number) => top + 22 + step * i
  const h = gy(graph.length - 1) + bottom
  const my = graph.length < 2 ? gy(0) : (gy(0) + gy(graph.length - 1)) / 2
  const px = (n: number) => `${(n / w) * 100}%`
  const py = (n: number) => `${(n / h) * 100}%`
  const lx = px(left - 16)
  const ty = py(h - 18)

  return (
    <figure
      data-component="limit-graph"
      aria-label={i18n.t("go.graph.label")}
      data-visible={visible() ? "" : undefined}
      ref={root}
    >
      <div data-slot="plot">
        <svg
          viewBox={`0 0 ${w} ${h}`}
          preserveAspectRatio="none"
          role="img"
          aria-hidden="true"
          style={{ height: `${h}px` }}
        >
          <g data-slot="grid">
            <For each={ticks}>
              {(t, i) => (
                <line x1={x(t)} y1={h - bottom} x2={x(t)} y2={top} data-grid style={{ "--d": `${i() * 100}ms` }} />
              )}
            </For>
          </g>

          <line x1={left} y1={h - bottom} x2={left} y2={top} data-stub />

          <g data-slot="bars">
            <For each={graph}>
              {(m, i) => (
                <rect
                  data-animate="bar"
                  data-model={m.id}
                  style={{ "--d": m.d }}
                  x={left}
                  y={gy(i()) - bh / 2}
                  width={Math.max(0, ("infinite" in m ? infiniteX : x(ratio(m.req))) - left)}
                  height={bh}
                  data-bar
                  data-kind={"infinite" in m ? "infinite" : "go"}
                />
              )}
            </For>
          </g>
        </svg>

        <div data-slot="ylabels" aria-hidden="true">
          <span data-ylabel style={{ "--x": lx, "--y": py(my) } as any}>
            {i18n.t("go.graph.go")}
          </span>
        </div>

        <div data-slot="xlabels" aria-hidden="true">
          <For each={shown}>
            {(t) => (
              <span
                data-xlabel
                data-tick={t}
                style={{ "--x": px(x(t)), "--y": ty, "--d": `${ticks.indexOf(t) * 100}ms` }}
              >
                {i18n.t("go.graph.tick", { n: t })}
              </span>
            )}
          </For>
        </div>

        <div data-slot="pills">
          <For each={graph}>
            {(m, i) => (
              <span
                data-item
                data-kind="go"
                data-model={m.id}
                data-edge={"edge" in m ? "" : undefined}
                data-infinite={"infinite" in m ? "" : undefined}
                style={{
                  "--x": px("infinite" in m ? infiniteX : x(ratio(m.req))),
                  "--y": py(gy(i())),
                  "--d": m.d,
                }}
              >
                <span data-label>
                  <span data-value>{"infinite" in m ? "\u221e" : m.req.toLocaleString()}</span>
                  <span data-name>{m.name}</span>
                  {m.id === "muse-spark-1.3-contributor" && (
                    <span data-regions>
                      (
                      <a href="https://ai.developer.meta.com/legal/geographic-use-policy">
                        {i18n.t("go.graph.limitedRegions")}
                      </a>
                      )
                    </span>
                  )}
                  {"infinite" in m && <span data-limited>({i18n.t("go.graph.limitedTime")})</span>}
                </span>
              </span>
            )}
          </For>
        </div>
      </div>

      <figcaption>
        <div data-slot="caption-row">
          <div data-slot="caption-left">
            <div data-slot="caption-meta">
              <span data-slot="caption-label">{i18n.t("go.graph.label")}</span>
              <a data-slot="caption-link" href={props.href}>
                {i18n.t("go.graph.usageLimits")}
              </a>
            </div>
          </div>
        </div>
      </figcaption>
    </figure>
  )
}
