import { For, createSignal, onCleanup, onMount } from "solid-js"
import { useI18n } from "~/context/i18n"
import { RollingNumber } from "./rolling-number"

export function LimitsGraph(props: { href: string }) {
  let root!: HTMLElement
  const [visible, setVisible] = createSignal(false)
  const [boosted, setBoosted] = createSignal(false)
  const [promoted, setPromoted] = createSignal<string[]>([])
  let timer: ReturnType<typeof setTimeout> | undefined

  const i18n = useI18n()

  onMount(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)")
    const finish = () => {
      if (!motion.matches) return
      clearTimeout(timer)
      setVisible(true)
      setBoosted(true)
      setPromoted(bonuses.map((model) => model.id))
    }
    motion.addEventListener("change", finish)
    onCleanup(() => {
      clearTimeout(timer)
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
    { id: "glm-5.3-flash", name: "GLM-5.3-Flash", req: 3160, baseReq: 1580, bonus: "2x usage" },
    { id: "minimax-m3", name: "MiniMax M3", req: 3200 },
    { id: "qwen3.7-plus", name: "Qwen3.7 Plus", req: 4300 },
    { id: "hy3", name: "Hy3", req: 4300 },
    { id: "qwen3.8-flash", name: "Qwen3.8 Flash", req: 5400 },
    { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash", req: 7600 },
    { id: "longcat-2.0", name: "LongCat-2.0", req: 11400 },
    { id: "omen-alpha", name: "Omen Alpha", req: 11600 },
    { id: "mimo-v2.5", name: "MiMo-V2.5", req: 30100 },
    { id: "muse-spark-1.3-contributor", name: "Muse Spark 1.3 Contributor", req: 45300, edge: true },
  ].map((model, index) => ({ ...model, d: `${50 + index * 25}ms` }))
  const bonuses = graph.filter((model) => model.baseReq)

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
  const timing = () => {
    const style = getComputedStyle(root)
    return {
      duration: Number.parseFloat(style.getPropertyValue("--bonus-duration")),
      easing: style.getPropertyValue("--spring-easing").trim(),
      spinEasing: style.getPropertyValue("--digit-easing").trim(),
    }
  }

  return (
    <figure
      data-component="limit-graph"
      aria-label={i18n.t("go.graph.label")}
      data-visible={visible() ? "" : undefined}
      data-boosted={boosted() ? "" : undefined}
      ref={root}
      onAnimationStart={(event) => {
        if (!(event.target instanceof SVGElement) || event.animationName !== "go-graph-reveal") return
        if (event.target.hasAttribute("data-stage-end") && !boosted()) {
          const duration = Number.parseFloat(getComputedStyle(root).getPropertyValue("--reveal-duration"))
          timer = setTimeout(() => setBoosted(true), duration * 0.6)
          return
        }
        if (event.target.dataset.animate !== "bonus") return
        const model = event.target.dataset.model
        if (!model) return
        setPromoted((current) => [...current, model])
      }}
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
                <>
                  <rect
                    data-animate="bar"
                    data-model={m.id}
                    data-stage-end={i() === graph.length - 1 ? "" : undefined}
                    style={{ "--d": m.d }}
                    x={left}
                    y={gy(i()) - bh / 2}
                    width={Math.max(0, ("infinite" in m ? infiniteX : x(ratio(m.baseReq ?? m.req))) - left)}
                    height={bh}
                    data-bar
                    data-kind={"infinite" in m ? "infinite" : "go"}
                  />
                  {m.baseReq && (
                    <rect
                      data-animate="bonus"
                      data-model={m.id}
                      style={{ "--bonus-delay": `${bonuses.indexOf(m) * 60}ms` }}
                      x={x(ratio(m.baseReq)) + 2}
                      y={gy(i()) - bh / 2}
                      width={Math.max(0, x(ratio(m.req)) - x(ratio(m.baseReq)) - 2)}
                      height={bh}
                      data-bar
                      data-kind="promo"
                    />
                  )}
                </>
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
                data-promo={m.baseReq ? "" : undefined}
                style={{
                  "--x": px("infinite" in m ? infiniteX : x(ratio(m.baseReq ?? m.req))),
                  "--y": py(gy(i())),
                  "--d": m.d,
                  "--bonus-delay": `${Math.max(0, bonuses.indexOf(m)) * 60}ms`,
                  "--travel": `${"infinite" in m ? 0 : ((x(ratio(m.req)) - x(ratio(m.baseReq ?? m.req))) / w) * 100}cqw`,
                }}
              >
                <span data-label>
                  {!("infinite" in m) && m.baseReq ? (
                    <RollingNumber
                      value={promoted().includes(m.id) ? m.req : m.baseReq}
                      target={m.req}
                      timing={timing}
                    />
                  ) : (
                    <span data-value>{"infinite" in m ? "\u221e" : m.req.toLocaleString()}</span>
                  )}
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
                {"bonus" in m && <span data-bonus>{m.bonus}</span>}
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
