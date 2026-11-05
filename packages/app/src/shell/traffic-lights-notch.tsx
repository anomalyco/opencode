import { macVerticalTrafficLights } from "@/shell/sidebar-toggle"

// The content panels' corner radius and their offset from the window's top and start edges.
const panelRadius = 10

const panelInset = 8

// Room between the traffic lights and the pocket the panel bends around them.
const pocketPadding = 6

// The native buttons' size in points; they keep it at every renderer zoom.
const trafficLightSize = 14

/**
 * The top-left corner of the content panel once it bends around the traffic lights, in CSS pixels from the window's
 * top-left. `content` is where the content area starts now. Undefined while the panel is clear of the buttons.
 */
export function trafficLightsPocket(content: number, zoom: number) {
  const left = content + panelInset
  const lights = macVerticalTrafficLights(zoom)
  const right = lights.width / zoom + pocketPadding
  const bottom = (lights.y + trafficLightSize) / zoom + pocketPadding
  const width = right - left

  if (width <= 0) return

  // The pocket's corner is concentric with the zoom button.
  const corner = trafficLightSize / 2 / zoom + pocketPadding
  // As the panel's edge reaches the pocket's, its two corners shrink together so the bend flattens into the panel's
  // own rounded corner.
  const scale = Math.min(1, width / (panelRadius + corner))

  return { left, right, bottom, top: panelInset, outer: panelRadius * scale, inner: corner * scale }
}

type Pocket = NonNullable<ReturnType<typeof trafficLightsPocket>>

// The panel's edge from its start side, around the pocket, to its top edge, pushed `out` pixels away from the panel.
function edge(pocket: Pocket, out: number) {
  const { left, right, bottom, top, outer, inner } = pocket

  return [
    `M ${left - out} ${bottom + outer}`,
    `A ${outer + out} ${outer + out} 0 0 1 ${left + outer} ${bottom - out}`,
    `L ${right - inner} ${bottom - out}`,
    `A ${inner - out} ${inner - out} 0 0 0 ${right - out} ${bottom - inner}`,
    `L ${right - out} ${top + panelRadius}`,
    `A ${panelRadius + out} ${panelRadius + out} 0 0 1 ${right + panelRadius} ${top - out}`,
  ].join(" ")
}

// Clears the panel's own corner and hairline, which the bent edge replaces.
function cover(pocket: Pocket) {
  const { left, right, bottom, top, outer } = pocket

  return `${edge(pocket, 0)} L ${right + panelRadius} ${top - 2} L ${left - 2} ${top - 2} L ${left - 2} ${bottom + outer} Z`
}

/**
 * Paints the window's deep background over the content panel's top-left corner, so the panel bends around the native
 * traffic lights rather than passing under them. `content` is where the content area starts, in CSS pixels from the
 * window's left, or undefined without traffic lights; the sidebar's motion paints it on every frame.
 */
export function paintTrafficLightsNotch(svg: SVGSVGElement | undefined, content: number | undefined, zoom: number) {
  if (!svg) return
  const pocket = content === undefined ? undefined : trafficLightsPocket(content, zoom)
  const [fill, line] = svg.children

  if (!pocket) {
    svg.style.display = "none"

    return
  }

  svg.style.display = ""
  fill?.setAttribute("d", cover(pocket))
  // The panel's 0.5px hairline sits just outside its edge.
  line?.setAttribute("d", edge(pocket, 0.25))
}

export function TrafficLightsNotch(props: { ref: (element: SVGSVGElement) => void }) {
  return (
    <svg
      ref={props.ref}
      data-slot="traffic-lights-notch"
      aria-hidden="true"
      class="pointer-events-none absolute top-0 left-0 z-[5] size-40 overflow-visible"
      style={{ display: "none" }}
    >
      <path class="fill-[var(--v2-background-bg-deep)]" />
      {/* The hairline the panels' raised elevation draws around them. */}
      <path
        fill="none"
        stroke-width="0.5"
        class="stroke-[var(--v2-alpha-dark-12)] [[data-color-scheme=dark]_&]:stroke-[var(--v2-alpha-light-16)]"
      />
    </svg>
  )
}
