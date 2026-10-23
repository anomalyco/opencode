import { Match, Predicate } from "effect"
import type { Locator, Page } from "patchright-core"
import type { JsonObject } from "./protocol.ts"

type GhostCursorStyle = "distance-glide" | "spring-inertia"

export type GhostCursorClientOptions = {
  readonly color?: string
  readonly size?: number
  readonly zIndex?: number
  readonly style?: GhostCursorStyle
}

type GhostCursorTone = "neutral" | "accent" | "success" | "warn"

export type GhostCursorCaptionOptions = {
  readonly subtitle?: string
  readonly step?: string
  readonly tone?: GhostCursorTone
}

export type GhostCursorCalloutOptions = {
  readonly detail?: string
  readonly tone?: GhostCursorTone
}

export type GhostCursorZoomOptions = {
  readonly scale?: number
  readonly durationMs?: number
}

export type GhostCursorSpotlightOptions = {
  readonly label?: string
  readonly detail?: string
  readonly tone?: GhostCursorTone
  readonly padding?: number
  readonly dim?: number
}

export type GhostCursorMouseAction = {
  readonly type: "move" | "down" | "up"
  readonly x: number
  readonly y: number
  readonly button: "left" | "right" | "middle" | "none"
}

type GhostCursorEvaluatePayload = {
  readonly cursorOptions?: GhostCursorClientOptions
}

type GhostCursorCaptionPayload = {
  readonly title: string
  readonly options?: GhostCursorCaptionOptions
}

type GhostCursorRect = {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

type GhostCursorCalloutPayload = {
  readonly rect: GhostCursorRect
  readonly label: string
  readonly options?: GhostCursorCalloutOptions
}

type GhostCursorZoomPayload = {
  readonly rect: GhostCursorRect | null
  readonly scale: number
  readonly durationMs: number
}

type GhostCursorSpotlightPayload = {
  readonly rect: GhostCursorRect | null
  readonly options?: GhostCursorSpotlightOptions
}

type GhostCursorKeysPayload = {
  readonly keys: readonly string[]
  readonly label?: string
}

type GhostCursorBrowserApi = {
  readonly show: (options?: GhostCursorClientOptions) => void
  readonly hide: () => void
  readonly restore: (position: { readonly x: number; readonly y: number }) => void
  readonly applyMouseEvent: (action: GhostCursorMouseAction) => Promise<void>
  readonly setCaption: (payload: GhostCursorCaptionPayload | null) => void
  readonly showCallout: (payload: GhostCursorCalloutPayload) => void
  readonly clearCallouts: () => void
  readonly zoomTo: (payload: GhostCursorZoomPayload) => Promise<void>
  readonly setSpotlight: (payload: GhostCursorSpotlightPayload) => Promise<void>
  readonly showKeys: (payload: GhostCursorKeysPayload) => void
  readonly isVisible: () => boolean
}

const ghostCursorElementId = "__opencode_browser_ghost_cursor__"

export const ghostCursorClientSource = `(() => {
  if (window !== window.top) {
    return;
  }
  if (globalThis.__opencodeBrowserGhostCursor?.version === 12) {
    return;
  }
  globalThis.__opencodeBrowserGhostCursor?.hide?.();
  const cursorId = "${ghostCursorElementId}";
  const stageId = "__opencode_browser_ghost_stage__";
  const captionId = "__opencode_browser_ghost_caption__";
  const spotlightId = "__opencode_browser_ghost_spotlight__";
  const keysId = "__opencode_browser_ghost_keys__";
  const positionStorageKey = "__opencode_browser_ghost_cursor_position__";
  const captionStorageKey = "__opencode_browser_ghost_cursor_caption__";
  const defaults = {
    color: "#1c1c1f",
    size: 23,
    zIndex: 2147483646,
    style: "distance-glide",
  };
  const svgNamespace = "http://www.w3.org/2000/svg";
  const cursorPathData =
    "M0.92 2.18C0.61 1.37 1.42 0.58 2.23 0.9L14.39 5.68C15.23 6.01 15.23 7.2 14.39 7.54L9.86 9.37C9.61 9.47 9.41 9.67 9.31 9.92L7.44 14.42C7.09 15.25 5.9 15.23 5.58 14.39L0.92 2.18Z";

  const PI = Math.PI;
  const FRAME_MS = 1000 / 60;
  const tones = {
    neutral: "#e0b35a",
    accent: "#93c5fd",
    success: "#a8ba96",
    warn: "#f59e0b",
  };
  const initialX = Math.round(window.innerWidth / 2);
  const initialY = Math.round(window.innerHeight / 2);

  const state = {
    element: null,
    arrow: null,
    stage: null,
    targetX: initialX,
    targetY: initialY,
    renderedX: initialX,
    renderedY: initialY,
    vx: 0,
    vy: 0,
    deg: 0,
    vDeg: 0,
    scale: 1,
    vScale: 0,
    arcSign: 1,
    lastMoveDist: 0,
    flight: null,
    camera: { scale: 1, tx: 0, ty: 0 },
    cameraAnim: null,
    spotlight: null,
    spotlightAnim: null,
    keysTimer: undefined,
    effects: [],
    flightResolvers: [],
    activeUntil: 0,
    actionQueue: Promise.resolve(),
    tickTimer: undefined,
    previousFrameTime: undefined,
    nextTickDue: 0,
    mode: "auto",
    options: defaults,
    fadeTimer: undefined,
    removeTimer: undefined,
  };
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const smoothstep = (e0, e1, x) => {
    const t = clamp((x - e0) / Math.max(1e-5, e1 - e0), 0, 1);
    return t * t * (3 - 2 * t);
  };
  const smootherstep = (t) => {
    const u = clamp(t, 0, 1);
    return u * u * u * (u * (u * 6 - 15) + 10);
  };
  const easeOutExpo = (t) => {
    const u = clamp(t, 0, 1);
    return u === 1 ? 1 : 1 - Math.pow(2, -10 * u);
  };
  const easeOutQuart = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 4);
  const mergeOptions = (options) => ({
    color: typeof options?.color === "string" ? options.color : defaults.color,
    size: typeof options?.size === "number" && Number.isFinite(options.size) ? options.size : defaults.size,
    zIndex: typeof options?.zIndex === "number" && Number.isFinite(options.zIndex) ? options.zIndex : defaults.zIndex,
    style: typeof options?.style === "string" ? options.style : state.options.style || defaults.style,
  });
  const formatCoord = (value) => String(Number(value.toFixed(2)));
  const applyCamera = () => {
    const body = document.body;
    if (!body) return;
    const { scale, tx, ty } = state.camera;
    if (Math.abs(scale - 1) < 0.001 && Math.abs(tx) < 0.25 && Math.abs(ty) < 0.25) {
      body.style.transform = "";
      body.style.transformOrigin = "";
      return;
    }
    body.style.transformOrigin = "0 0";
    body.style.transform = "translate3d(" + formatCoord(tx) + "px, " + formatCoord(ty) + "px, 0) scale(" + formatCoord(scale) + ")";
  };
  const applyPosition = () => {
    if (!state.element) return;
    state.element.style.transform = "translate3d(" + formatCoord(state.renderedX) + "px, " + formatCoord(state.renderedY) + "px, 0)";
    if (state.arrow) {
      const pressed = state.element.dataset.pressed === "true";
      const cameraBoost = Math.pow(Math.max(1, state.camera.scale), 0.32);
      state.arrow.style.transform = "rotate(" + formatCoord(state.deg) + "deg) scale(" + formatCoord(state.scale * cameraBoost) + ")";
      state.arrow.style.filter = pressed
        ? "drop-shadow(0 1px 2px rgba(0,0,0,0.52))"
        : "drop-shadow(0 2.5px 5px rgba(0,0,0,0.34)) drop-shadow(0 0.5px 1.5px rgba(0,0,0,0.22))";
    }
  };

  const sampleBezier = (b, u) => {
    const inv = 1 - u;
    const x = inv * inv * inv * b.x0 + 3 * inv * inv * u * b.cx1 + 3 * inv * u * u * b.cx2 + u * u * u * b.x1;
    const y = inv * inv * inv * b.y0 + 3 * inv * inv * u * b.cy1 + 3 * inv * u * u * b.cy2 + u * u * u * b.y1;
    const tx = 3 * inv * inv * (b.cx1 - b.x0) + 6 * inv * u * (b.cx2 - b.cx1) + 3 * u * u * (b.x1 - b.cx2);
    const ty = 3 * inv * inv * (b.cy1 - b.y0) + 6 * inv * u * (b.cy2 - b.cy1) + 3 * u * u * (b.y1 - b.cy2);
    return { x, y, heading: Math.atan2(ty, tx) };
  };

  const ensureStage = () => {
    const existing = document.getElementById(stageId);
    if (existing instanceof HTMLDivElement) {
      state.stage = existing;
      return existing;
    }
    const stage = document.createElement("div");
    stage.id = stageId;
    stage.setAttribute("aria-hidden", "true");
    stage.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:" + (state.options.zIndex - 1) + ";overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Inter','SF Pro Text',sans-serif;";
    document.documentElement.appendChild(stage);
    state.stage = stage;
    return stage;
  };
  const createSvgOverlay = (x, y, boxSize) => {
    const stage = ensureStage();
    const svg = document.createElementNS(svgNamespace, "svg");
    const half = boxSize / 2;
    svg.setAttribute("viewBox", (-half) + " " + (-half) + " " + boxSize + " " + boxSize);
    svg.style.cssText = "position:fixed;left:" + formatCoord(x - half) + "px;top:" + formatCoord(y - half) + "px;width:" + boxSize + "px;height:" + boxSize + "px;pointer-events:none;overflow:visible;";
    stage.appendChild(svg);
    return svg;
  };
  const populateChip = (chip, toneColor, label, detail) => {
    chip.replaceChildren();
    if (!label) {
      chip.style.display = "none";
      return;
    }
    const dot = document.createElement("span");
    dot.style.cssText = "width:7px;height:7px;border-radius:999px;background:" + toneColor + ";flex-shrink:0;";
    const txt = document.createElement("span");
    txt.textContent = label;
    chip.append(dot, txt);
    if (detail) {
      const det = document.createElement("span");
      det.textContent = detail;
      det.style.cssText = "font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;font-weight:500;color:#9ca3af;";
      chip.appendChild(det);
    }
  };
  const styleChipAtRect = (chip, x, y, h, alpha = 1) => {
    const placeAbove = y > 64;
    const chipTop = placeAbove ? Math.max(12, y - 40) : Math.min(window.innerHeight - 48, y + h + 12);
    const chipLeft = clamp(x, 16, Math.max(16, window.innerWidth - 320));
    chip.style.cssText = [
      "position:fixed",
      "left:" + formatCoord(chipLeft) + "px",
      "top:" + formatCoord(chipTop) + "px",
      "display:inline-flex",
      "align-items:center",
      "gap:8px",
      "padding:5px 12px",
      "background:rgba(14, 14, 13, 0.94)",
      "backdrop-filter:blur(12px)",
      "border:1px solid rgba(255,255,255,0.16)",
      "border-radius:999px",
      "box-shadow:0 10px 24px rgba(0,0,0,0.42)",
      "font-size:12px",
      "font-weight:600",
      "color:#f4f3ef",
      "white-space:nowrap",
      "opacity:" + formatCoord(alpha),
    ].join(";");
  };

  // Tactile specular bloom + SVG variable-stroke shockwave ring
  const spawnClickPulse = (x, y, phase) => {
    const now = performance.now();
    const R = 24 * Math.pow(Math.max(1, state.camera.scale), 0.25);

    if (phase === "down") {
      const svg = createSvgOverlay(x, y, 64);
      const halo = document.createElementNS(svgNamespace, "circle");
      halo.setAttribute("r", "4");
      halo.setAttribute("fill", "rgba(250, 250, 249, 0.28)");
      const dot = document.createElementNS(svgNamespace, "circle");
      dot.setAttribute("r", "3.2");
      dot.setAttribute("fill", "#fafaf9");
      dot.setAttribute("stroke", "rgba(24, 24, 27, 0.65)");
      dot.setAttribute("stroke-width", "1.2");
      svg.append(halo, dot);
      state.effects.push({
        el: svg,
        startTime: now,
        durationMs: 130,
        step: (u) => {
          const e = easeOutQuart(u);
          halo.setAttribute("r", formatCoord(3 + 8 * e));
          halo.setAttribute("opacity", formatCoord(0.55 * (1 - e)));
          dot.setAttribute("r", formatCoord(2.2 + 2.6 * Math.sin(u * PI)));
          dot.setAttribute("opacity", formatCoord(1 - u * 0.6));
        },
      });
      return;
    }

    const svg = createSvgOverlay(x, y, 100);
    const bloom = document.createElementNS(svgNamespace, "circle");
    bloom.setAttribute("fill", "rgba(250, 250, 249, 0.16)");
    const contrastRing = document.createElementNS(svgNamespace, "circle");
    contrastRing.setAttribute("fill", "none");
    contrastRing.setAttribute("stroke", "rgba(18, 18, 20, 0.55)");
    const mainRing = document.createElementNS(svgNamespace, "circle");
    mainRing.setAttribute("fill", "none");
    mainRing.setAttribute("stroke", "#fafaf9");
    svg.append(bloom, contrastRing, mainRing);
    state.effects.push({
      el: svg,
      startTime: now,
      durationMs: 300,
      step: (u) => {
        const e = easeOutExpo(u);
        const r = 4 + (R - 4) * e;
        const sw = 2.8 * (1 - 0.84 * e);
        const alpha = (1 - u) * (1 - u * 0.35);
        bloom.setAttribute("r", formatCoord(r * 0.82));
        bloom.setAttribute("opacity", formatCoord(Math.pow(1 - u, 2.2) * 0.85));
        contrastRing.setAttribute("r", formatCoord(r));
        contrastRing.setAttribute("stroke-width", formatCoord(sw + 1.6));
        contrastRing.setAttribute("opacity", formatCoord(alpha * 0.65));
        mainRing.setAttribute("r", formatCoord(r));
        mainRing.setAttribute("stroke-width", formatCoord(sw));
        mainRing.setAttribute("opacity", formatCoord(alpha));
      },
    });
  };
  const stepEffects = (timestamp) => {
    for (let i = state.effects.length - 1; i >= 0; i--) {
      const fx = state.effects[i];
      const u = (timestamp - fx.startTime) / fx.durationMs;
      if (u >= 1) {
        fx.el.remove();
        state.effects.splice(i, 1);
        continue;
      }
      fx.step(u);
    }
  };
  const flushFlightResolvers = () => {
    const resolvers = state.flightResolvers.splice(0);
    for (const resolve of resolvers) {
      try { resolve(); } catch {}
    }
  };

  const stepCameraAndSpotlight = (timestamp) => {
    let active = false;
    if (state.cameraAnim) {
      const ca = state.cameraAnim;
      const u = clamp((timestamp - ca.startTime) / ca.durationMs, 0, 1);
      const s = smootherstep(u);
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const scale = Math.exp(ca.logS0 + (ca.logS1 - ca.logS0) * s);
      const fx = ca.fx0 + (ca.fx1 - ca.fx0) * s;
      const fy = ca.fy0 + (ca.fy1 - ca.fy0) * s;
      state.camera.scale = scale;
      state.camera.tx = clamp(vw / 2 - fx * scale, vw * (1 - scale), 0);
      state.camera.ty = clamp(vh / 2 - fy * scale, vh * (1 - scale), 0);
      applyCamera();
      if (!state.flight && ca.cursorPageX !== undefined) {
        state.renderedX = ca.cursorPageX * state.camera.scale + state.camera.tx;
        state.renderedY = ca.cursorPageY * state.camera.scale + state.camera.ty;
        state.targetX = state.renderedX;
        state.targetY = state.renderedY;
        state.vx = 0;
        state.vy = 0;
      }
      if (u >= 1) {
        const resolve = ca.resolve;
        state.cameraAnim = null;
        try { resolve?.(); } catch {}
      } else {
        active = true;
      }
    }
    if (state.spotlightAnim && state.spotlight) {
      const sa = state.spotlightAnim;
      const u = clamp((timestamp - sa.startTime) / sa.durationMs, 0, 1);
      const s = smootherstep(u);
      const sp = state.spotlight;
      sp.x = sa.x0 + (sa.x1 - sa.x0) * s;
      sp.y = sa.y0 + (sa.y1 - sa.y0) * s;
      sp.w = sa.w0 + (sa.w1 - sa.w0) * s;
      sp.h = sa.h0 + (sa.h1 - sa.h0) * s;
      sp.alpha = sa.a0 + (sa.a1 - sa.a0) * s;
      sp.render();
      if (u >= 1) {
        const resolve = sa.resolve;
        state.spotlightAnim = null;
        if (sp.alpha <= 0.01) {
          sp.el.remove();
          state.spotlight = null;
        }
        try { resolve?.(); } catch {}
      } else {
        active = true;
      }
    }
    return active;
  };

  const stepMotion = (timestamp, dt) => {
    stepEffects(timestamp);
    const camActive = stepCameraAndSpotlight(timestamp);
    const pressed = state.element?.dataset.pressed === "true";
    const pressDip = pressed ? -4.5 : 0;

    if (state.flight) {
      const f = state.flight;
      const u = clamp((timestamp - f.startTime) / f.durationMs, 0, 1);
      const s = smootherstep(u);
      const sample = sampleBezier(f.bezier, s);
      const prevX = state.renderedX;
      const prevY = state.renderedY;
      state.renderedX = sample.x;
      state.renderedY = sample.y;
      state.vx = (state.renderedX - prevX) / dt;
      state.vy = (state.renderedY - prevY) / dt;

      const bell = Math.pow(Math.sin(PI * Math.pow(u, 0.82)), 1.15);
      const bankDir = clamp((f.bezier.x1 - f.bezier.x0) / Math.max(40, f.dist), -1, 1) * 0.72 + state.arcSign * 0.28;
      const targetDeg = bankDir * 28 * f.farFactor * bell;
      state.deg += (targetDeg + pressDip - state.deg) * Math.min(1, dt * 30);

      if (u >= 1) {
        const endSample = sampleBezier(f.bezier, 1);
        const overshootSpeed = clamp(f.dist * 0.14, 0, 85);
        state.vx = Math.cos(endSample.heading) * overshootSpeed;
        state.vy = Math.sin(endSample.heading) * overshootSpeed;
        state.flight = null;
        flushFlightResolvers();
      }
    } else {
      const omega = 26;
      const zeta = 0.88;
      const k = omega * omega;
      const c = 2 * zeta * omega;
      const substeps = 4;
      const sdt = dt / substeps;
      for (let i = 0; i < substeps; i++) {
        const ax = -k * (state.renderedX - state.targetX) - c * state.vx;
        const ay = -k * (state.renderedY - state.targetY) - c * state.vy;
        state.vx += ax * sdt;
        state.vy += ay * sdt;
        state.renderedX += state.vx * sdt;
        state.renderedY += state.vy * sdt;
      }

      const distToTarget = Math.hypot(state.targetX - state.renderedX, state.targetY - state.renderedY);
      const speed = Math.hypot(state.vx, state.vy);
      if (distToTarget < 1.2 && speed < 18) {
        state.renderedX = state.targetX;
        state.renderedY = state.targetY;
        state.vx = 0;
        state.vy = 0;
        flushFlightResolvers();
      }

      const distScale = smoothstep(35, 190, state.lastMoveDist);
      const velTilt = clamp((state.vx * 0.015 - state.vy * 0.005) * (0.3 + 0.7 * distScale), -16, 16);
      const targetDeg = velTilt + pressDip;
      const rotAcc = -380 * (state.deg - targetDeg) - 35 * state.vDeg;
      state.vDeg += rotAcc * dt;
      state.deg += state.vDeg * dt;
      if (Math.abs(state.deg - pressDip) < 0.15 && Math.abs(state.vDeg) < 1) {
        state.deg = pressDip;
        state.vDeg = 0;
      }
    }

    const targetScale = pressed ? 0.80 : 1;
    const scAcc = -680 * (state.scale - targetScale) - 32 * state.vScale;
    state.vScale += scAcc * dt;
    state.scale += state.vScale * dt;
    if (Math.abs(state.scale - targetScale) < 0.005 && Math.abs(state.vScale) < 0.05) {
      state.scale = targetScale;
      state.vScale = 0;
    }

    const moving = Boolean(state.flight)
      || camActive
      || Math.hypot(state.targetX - state.renderedX, state.targetY - state.renderedY) > 0.25
      || Math.hypot(state.vx, state.vy) > 2
      || Math.abs(state.deg - pressDip) > 0.2
      || Math.abs(state.scale - targetScale) > 0.01;
    return moving || state.effects.length > 0 || timestamp < state.activeUntil;
  };

  const onTick = () => {
    state.tickTimer = undefined;
    if (!state.element && !state.cameraAnim && !state.spotlightAnim) {
      state.previousFrameTime = undefined;
      flushFlightResolvers();
      state.flight = null;
      return;
    }
    const timestamp = performance.now();
    const dt = state.previousFrameTime === undefined
      ? FRAME_MS / 1000
      : clamp((timestamp - state.previousFrameTime) / 1000, 1 / 240, 0.05);
    state.previousFrameTime = timestamp;
    const active = stepMotion(timestamp, dt);
    applyPosition();
    if (active) {
      state.nextTickDue = Math.max(timestamp + 4, (state.nextTickDue || timestamp) + FRAME_MS);
      state.tickTimer = window.setTimeout(onTick, Math.max(4, Math.round(state.nextTickDue - performance.now())));
    } else {
      state.previousFrameTime = undefined;
      state.nextTickDue = 0;
    }
  };
  const startLoop = () => {
    if (state.tickTimer === undefined) {
      state.nextTickDue = performance.now();
      state.tickTimer = window.setTimeout(onTick, 0);
    }
  };
  const applyVisualOptions = () => {
    if (!state.element) return;
    state.element.style.width = state.options.size + "px";
    state.element.style.height = state.options.size + "px";
    state.element.style.zIndex = String(state.options.zIndex);
    const arrow = state.arrow;
    if (arrow instanceof SVGSVGElement && arrow.firstElementChild) {
      arrow.firstElementChild.setAttribute("fill", state.options.color);
    }
  };
  const ensureElement = () => {
    const existing = document.getElementById(cursorId);
    if (existing instanceof HTMLDivElement) {
      state.element = existing;
      state.arrow = existing.querySelector("svg");
      return existing;
    }
    const element = document.createElement("div");
    element.id = cursorId;
    element.setAttribute("aria-hidden", "true");
    element.style.position = "fixed";
    element.style.left = "0";
    element.style.top = "0";
    element.style.pointerEvents = "none";
    element.style.boxSizing = "border-box";
    element.style.transition = "opacity 160ms ease-out";
    element.style.transformOrigin = "0 0";
    element.style.willChange = "transform, opacity";
    element.style.opacity = "0";
    element.dataset.motion = "spring";
    const arrow = document.createElementNS(svgNamespace, "svg");
    arrow.setAttribute("viewBox", "0 0 16 16");
    arrow.style.display = "block";
    arrow.style.width = "100%";
    arrow.style.height = "100%";
    arrow.style.overflow = "visible";
    arrow.style.transformOrigin = "8.75% 8.75%";
    arrow.style.filter = "drop-shadow(0 2.5px 5px rgba(0,0,0,0.34)) drop-shadow(0 0.5px 1.5px rgba(0,0,0,0.22))";
    const arrowPath = document.createElementNS(svgNamespace, "path");
    arrowPath.setAttribute("d", cursorPathData);
    arrowPath.setAttribute("fill", state.options.color);
    arrowPath.setAttribute("stroke", "#fafafa");
    arrowPath.setAttribute("stroke-width", "1.5");
    arrowPath.setAttribute("stroke-linejoin", "round");
    arrowPath.setAttribute("paint-order", "stroke");
    arrow.appendChild(arrowPath);
    element.appendChild(arrow);
    document.documentElement.appendChild(element);
    state.element = element;
    state.arrow = arrow;
    return element;
  };
  const clearIdleTimers = () => {
    if (state.fadeTimer !== undefined) window.clearTimeout(state.fadeTimer);
    if (state.removeTimer !== undefined) window.clearTimeout(state.removeTimer);
    state.fadeTimer = undefined;
    state.removeTimer = undefined;
  };
  const scheduleIdleFade = () => {
    if (state.mode !== "auto") return;
    clearIdleTimers();
    state.fadeTimer = window.setTimeout(() => {
      if (state.element) state.element.style.opacity = "0";
      state.removeTimer = window.setTimeout(() => {
        state.element?.remove();
        state.element = null;
        state.arrow = null;
        state.removeTimer = undefined;
      }, 160);
      state.fadeTimer = undefined;
    }, 620);
  };
  const show = (options) => {
    clearIdleTimers();
    state.options = mergeOptions(options);
    state.mode = "persistent";
    const element = ensureElement();
    applyVisualOptions();
    applyPosition();
    element.style.opacity = "1";
    element.dataset.pressed = "false";
  };
  const hide = () => {
    clearIdleTimers();
    if (state.tickTimer !== undefined) window.clearTimeout(state.tickTimer);
    state.tickTimer = undefined;
    state.previousFrameTime = undefined;
    flushFlightResolvers();
    state.flight = null;
    state.camera = { scale: 1, tx: 0, ty: 0 };
    state.cameraAnim = null;
    state.spotlightAnim = null;
    state.spotlight = null;
    applyCamera();
    state.effects.splice(0);
    state.mode = "disabled";
    state.element?.remove();
    state.element = null;
    state.arrow = null;
    document.getElementById(stageId)?.remove();
    state.stage = null;
  };
  const restore = (position) => {
    if (typeof position?.x !== "number" || typeof position?.y !== "number") return;
    clearIdleTimers();
    state.mode = "persistent";
    state.targetX = position.x;
    state.targetY = position.y;
    state.renderedX = position.x;
    state.renderedY = position.y;
    state.vx = 0;
    state.vy = 0;
    state.deg = 0;
    state.vDeg = 0;
    state.scale = 1;
    state.vScale = 0;
    state.flight = null;
    const element = ensureElement();
    applyVisualOptions();
    element.dataset.targetX = String(position.x);
    element.dataset.targetY = String(position.y);
    element.dataset.pressed = "false";
    element.style.opacity = "1";
    applyPosition();
  };
  const waitMs = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));
  const runSingleMouseAction = (action) => {
    if (state.mode === "disabled" || typeof action?.x !== "number" || typeof action?.y !== "number") {
      return Promise.resolve();
    }
    const element = ensureElement();
    applyVisualOptions();
    state.targetX = action.x;
    state.targetY = action.y;
    try {
      window.sessionStorage.setItem(positionStorageKey, JSON.stringify({ x: action.x, y: action.y }));
    } catch {}
    element.dataset.targetX = String(action.x);
    element.dataset.targetY = String(action.y);
    element.style.opacity = "1";

    if (action.type === "down") {
      element.dataset.pressed = "true";
      state.activeUntil = performance.now() + 140;
      applyPosition();
      spawnClickPulse(action.x, action.y, "down");
      startLoop();
      scheduleIdleFade();
      return waitMs(35);
    }
    if (action.type === "up") {
      element.dataset.pressed = "false";
      state.vScale = 2.6;
      state.activeUntil = performance.now() + 360;
      applyPosition();
      spawnClickPulse(action.x, action.y, "up");
      startLoop();
      scheduleIdleFade();
      return waitMs(45);
    }

    const dx = action.x - state.renderedX;
    const dy = action.y - state.renderedY;
    const dist = Math.hypot(dx, dy);
    state.lastMoveDist = dist;
    if (dist < 4) {
      state.renderedX = action.x;
      state.renderedY = action.y;
      state.vx = 0;
      state.vy = 0;
      state.deg = 0;
      applyPosition();
      scheduleIdleFade();
      return Promise.resolve();
    }

    const style = state.options.style || "distance-glide";
    state.arcSign *= -1;
    const nx = -dy / dist;
    const ny = dx / dist;
    flushFlightResolvers();

    if (style === "spring-inertia") {
      const distGate = smoothstep(38, 190, dist);
      const kick = dist * 0.13 * distGate * state.arcSign * 5.2;
      state.vx += nx * kick;
      state.vy += ny * kick;
      state.flight = null;
      const expectedMs = clamp(120 + Math.sqrt(dist) * 6.2, 120, 310);
      state.activeUntil = performance.now() + expectedMs + 140;
      startLoop();
      scheduleIdleFade();
      return new Promise((resolve) => {
        const safetyTimer = window.setTimeout(() => {
          state.renderedX = action.x;
          state.renderedY = action.y;
          state.vx = 0;
          state.vy = 0;
          state.deg = 0;
          applyPosition();
          resolve();
        }, expectedMs + 140);
        state.flightResolvers.push(() => {
          window.clearTimeout(safetyTimer);
          resolve();
        });
      });
    }

    const farFactor = smoothstep(50, 220, dist);
    const arcOffset = dist * 0.16 * farFactor * state.arcSign;
    const durationMs = clamp(125 + Math.sqrt(dist) * 6.2, 125, 315);
    state.flight = {
      startTime: performance.now(),
      durationMs,
      dist,
      farFactor,
      bezier: {
        x0: state.renderedX,
        y0: state.renderedY,
        cx1: state.renderedX + dx * 0.3 + nx * arcOffset,
        cy1: state.renderedY + dy * 0.3 + ny * arcOffset,
        cx2: state.renderedX + dx * 0.72 + nx * arcOffset * 0.55,
        cy2: state.renderedY + dy * 0.72 + ny * arcOffset * 0.55,
        x1: action.x,
        y1: action.y,
      },
    };
    state.activeUntil = performance.now() + durationMs + 150;
    startLoop();
    scheduleIdleFade();

    return new Promise((resolve) => {
      const safetyTimer = window.setTimeout(() => {
        state.flight = null;
        state.renderedX = action.x;
        state.renderedY = action.y;
        state.deg = 0;
        applyPosition();
        resolve();
      }, durationMs + 160);
      state.flightResolvers.push(() => {
        window.clearTimeout(safetyTimer);
        resolve();
      });
    });
  };
  const applyMouseEvent = (action) => {
    const next = state.actionQueue.then(() => runSingleMouseAction(action), () => runSingleMouseAction(action));
    state.actionQueue = next;
    return next;
  };

  const zoomTo = (payload) => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const S = clamp(typeof payload?.scale === "number" ? payload.scale : 1, 1, 3.2);
    const durationMs = clamp(typeof payload?.durationMs === "number" ? payload.durationMs : 360, 80, 1200);
    const fx0 = (vw / 2 - state.camera.tx) / state.camera.scale;
    const fy0 = (vh / 2 - state.camera.ty) / state.camera.scale;
    let fx1 = vw / 2;
    let fy1 = vh / 2;
    if (payload?.rect && S > 1.001) {
      const cx = payload.rect.x + payload.rect.width / 2;
      const cy = payload.rect.y + payload.rect.height / 2;
      const ux = (cx - state.camera.tx) / state.camera.scale;
      const uy = (cy - state.camera.ty) / state.camera.scale;
      const halfVisW = (vw * 0.5) / S;
      const halfVisH = (vh * 0.5) / S;
      fx1 = clamp(ux, halfVisW, vw - halfVisW);
      fy1 = clamp(uy, halfVisH, vh - halfVisH);
    }
    const cursorPageX = (state.renderedX - state.camera.tx) / state.camera.scale;
    const cursorPageY = (state.renderedY - state.camera.ty) / state.camera.scale;
    return new Promise((resolve) => {
      state.cameraAnim = {
        startTime: performance.now(),
        durationMs,
        logS0: Math.log(Math.max(1, state.camera.scale)),
        logS1: Math.log(S),
        fx0,
        fy0,
        fx1,
        fy1,
        cursorPageX,
        cursorPageY,
        resolve,
      };
      state.activeUntil = performance.now() + durationMs + 60;
      startLoop();
    });
  };

  const setSpotlight = (payload) => {
    const stage = ensureStage();
    if (!payload?.rect) {
      if (!state.spotlight) return Promise.resolve();
      const sp = state.spotlight;
      return new Promise((resolve) => {
        state.spotlightAnim = {
          startTime: performance.now(),
          durationMs: 200,
          x0: sp.x, y0: sp.y, w0: sp.w, h0: sp.h, a0: sp.alpha,
          x1: sp.x, y1: sp.y, w1: sp.w, h1: sp.h, a1: 0,
          resolve,
        };
        state.activeUntil = performance.now() + 240;
        startLoop();
      });
    }
    const pad = typeof payload.options?.padding === "number" ? payload.options.padding : 10;
    const dim = typeof payload.options?.dim === "number" ? payload.options.dim : 0.56;
    const toneColor = tones[payload.options?.tone] || tones.neutral;
    const x1 = payload.rect.x - pad;
    const y1 = payload.rect.y - pad;
    const w1 = payload.rect.width + pad * 2;
    const h1 = payload.rect.height + pad * 2;

    if (!state.spotlight) {
      const container = document.createElement("div");
      container.id = spotlightId;
      container.style.cssText = "position:fixed;inset:0;pointer-events:none;";
      const hole = document.createElement("div");
      const chip = document.createElement("div");
      container.append(hole, chip);
      stage.appendChild(container);
      state.spotlight = {
        el: container,
        hole,
        chip,
        x: x1, y: y1, w: w1, h: h1,
        alpha: 0,
        dim,
        toneColor,
        label: "",
        render() {
          const sp = this;
          sp.hole.style.cssText = [
            "position:fixed",
            "left:" + formatCoord(sp.x) + "px",
            "top:" + formatCoord(sp.y) + "px",
            "width:" + formatCoord(sp.w) + "px",
            "height:" + formatCoord(sp.h) + "px",
            "border-radius:10px",
            "border:2px solid " + sp.toneColor,
            "box-shadow:0 0 0 9999px rgba(8, 8, 10, " + formatCoord(sp.dim * sp.alpha) + "), 0 0 28px rgba(224,179,90," + formatCoord(0.26 * sp.alpha) + ")",
            "opacity:" + formatCoord(sp.alpha),
            "box-sizing:border-box",
          ].join(";");
          if (sp.label) {
            styleChipAtRect(sp.chip, sp.x, sp.y, sp.h, sp.alpha);
          }
        },
      };
    }
    const sp = state.spotlight;
    sp.dim = dim;
    sp.toneColor = toneColor;
    sp.label = payload.options?.label || "";
    populateChip(sp.chip, toneColor, sp.label, payload.options?.detail);

    return new Promise((resolve) => {
      state.spotlightAnim = {
        startTime: performance.now(),
        durationMs: 240,
        x0: sp.x, y0: sp.y, w0: sp.w, h0: sp.h, a0: sp.alpha,
        x1, y1, w1, h1, a1: 1,
        resolve,
      };
      state.activeUntil = performance.now() + 270;
      startLoop();
    });
  };

  const showKeys = (payload) => {
    if (!payload?.keys?.length) return;
    const stage = ensureStage();
    document.getElementById(keysId)?.remove();
    if (state.keysTimer !== undefined) window.clearTimeout(state.keysTimer);
    const badge = document.createElement("div");
    badge.id = keysId;
    badge.style.cssText = [
      "position:fixed",
      "right:28px",
      "bottom:24px",
      "display:inline-flex",
      "align-items:center",
      "gap:6px",
      "padding:7px 11px",
      "background:rgba(16, 16, 15, 0.92)",
      "backdrop-filter:blur(14px)",
      "-webkit-backdrop-filter:blur(14px)",
      "border:1px solid rgba(255,255,255,0.14)",
      "border-radius:10px",
      "box-shadow:0 12px 28px rgba(0,0,0,0.38)",
      "color:#f4f3ef",
    ].join(";");
    for (const k of payload.keys) {
      const kbd = document.createElement("kbd");
      kbd.textContent = k;
      kbd.style.cssText = [
        "display:inline-flex",
        "align-items:center",
        "justify-content:center",
        "min-width:22px",
        "height:22px",
        "padding:0 6px",
        "font-family:ui-monospace,SFMono-Regular,Menlo,monospace",
        "font-size:12px",
        "font-weight:600",
        "color:#fafafa",
        "background:rgba(255,255,255,0.11)",
        "border:1px solid rgba(255,255,255,0.2)",
        "border-bottom-width:2px",
        "border-radius:5px",
      ].join(";");
      badge.appendChild(kbd);
    }
    if (payload.label) {
      const lbl = document.createElement("span");
      lbl.textContent = payload.label;
      lbl.style.cssText = "font-size:12px;font-weight:500;color:#a1a1aa;margin-left:4px;";
      badge.appendChild(lbl);
    }
    stage.appendChild(badge);
    state.keysTimer = window.setTimeout(() => {
      badge.remove();
      state.keysTimer = undefined;
    }, 1500);
  };

  const setCaption = (payload) => {
    const stage = ensureStage();
    const existing = document.getElementById(captionId);
    if (!payload || !payload.title) {
      try { window.sessionStorage.removeItem(captionStorageKey); } catch {}
      if (existing) existing.remove();
      return;
    }
    try { window.sessionStorage.setItem(captionStorageKey, JSON.stringify(payload)); } catch {}
    if (existing) existing.remove();
    const wrap = document.createElement("div");
    wrap.id = captionId;
    wrap.style.cssText = [
      "position:fixed",
      "left:50%",
      "bottom:24px",
      "transform:translate3d(-50%, 0, 0)",
      "display:flex",
      "align-items:stretch",
      "gap:12px",
      "padding:10px 16px 10px 12px",
      "background:rgba(14, 14, 13, 0.88)",
      "backdrop-filter:blur(14px)",
      "-webkit-backdrop-filter:blur(14px)",
      "border:1px solid rgba(255, 255, 255, 0.12)",
      "border-radius:10px",
      "box-shadow:0 12px 32px rgba(0, 0, 0, 0.35)",
      "color:#e2dfd9",
      "pointer-events:none",
      "max-width:min(680px, 88vw)",
    ].join(";");
    const barColor = tones[payload.options?.tone] || tones.neutral;
    const bar = document.createElement("div");
    bar.style.cssText = "width:3.5px;border-radius:999px;background:" + barColor + ";";
    const textCol = document.createElement("div");
    textCol.style.cssText = "display:flex;flex-direction:column;justify-content:center;gap:2px;overflow:hidden;";
    const titleRow = document.createElement("div");
    titleRow.style.cssText = "display:flex;align-items:center;gap:8px;font-size:13.5px;font-weight:600;letter-spacing:-0.01em;color:#f4f3ef;white-space:nowrap;";
    if (payload.options?.step) {
      const stepBadge = document.createElement("span");
      stepBadge.textContent = payload.options.step;
      stepBadge.style.cssText = "font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;font-weight:600;padding:1px 6px;border-radius:4px;background:rgba(255,255,255,0.09);color:" + barColor + ";";
      titleRow.appendChild(stepBadge);
    }
    const titleSpan = document.createElement("span");
    titleSpan.textContent = payload.title;
    titleRow.appendChild(titleSpan);
    textCol.appendChild(titleRow);
    if (payload.options?.subtitle) {
      const sub = document.createElement("div");
      sub.textContent = payload.options.subtitle;
      sub.style.cssText = "font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;color:#9ca3af;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
      textCol.appendChild(sub);
    }
    wrap.append(bar, textCol);
    stage.appendChild(wrap);
  };
  const clearCallouts = () => {
    const stage = document.getElementById(stageId);
    if (!stage) return;
    for (const node of Array.from(stage.querySelectorAll("[data-bc-callout='true']"))) {
      node.remove();
    }
  };
  const showCallout = (payload) => {
    if (!payload?.rect) return;
    clearCallouts();
    const stage = ensureStage();
    const toneColor = tones[payload.options?.tone] || tones.neutral;
    const { x, y, width, height } = payload.rect;
    const container = document.createElement("div");
    container.dataset.bcCallout = "true";
    container.style.cssText = "position:fixed;inset:0;pointer-events:none;";

    const ring = document.createElement("div");
    ring.style.cssText = [
      "position:fixed",
      "left:" + formatCoord(x - 4) + "px",
      "top:" + formatCoord(y - 4) + "px",
      "width:" + formatCoord(width + 8) + "px",
      "height:" + formatCoord(height + 8) + "px",
      "border-radius:8px",
      "border:1.75px solid " + toneColor,
      "box-shadow:0 0 0 1px rgba(14,14,13,0.5), 0 0 20px rgba(224,179,90,0.22)",
      "box-sizing:border-box",
    ].join(";");

    const chip = document.createElement("div");
    populateChip(chip, toneColor, payload.label, payload.options?.detail);
    styleChipAtRect(chip, x, y, height, 1);
    container.append(ring, chip);
    stage.appendChild(container);
  };
  globalThis.__opencodeBrowserGhostCursor = {
    version: 12,
    show,
    hide,
    restore,
    applyMouseEvent,
    setCaption,
    showCallout,
    clearCallouts,
    zoomTo,
    setSpotlight,
    showKeys,
    isVisible: () => state.mode !== "disabled" && Boolean(state.element),
  };
  const restoreSavedState = () => {
    try {
      const savedPosition = JSON.parse(window.sessionStorage.getItem(positionStorageKey) || "null");
      if (typeof savedPosition?.x === "number" && typeof savedPosition?.y === "number") {
        restore(savedPosition);
      }
      const savedCaption = JSON.parse(window.sessionStorage.getItem(captionStorageKey) || "null");
      if (savedCaption?.title) {
        setCaption(savedCaption);
      }
    } catch {}
  };
  const isForeignExtensionNode = (node) => {
    if (!(node instanceof Element)) return false;
    const tag = node.tagName ? node.tagName.toLowerCase() : "";
    if (tag.startsWith("com-1password-") || node.hasAttribute("data-onepassword-extension") || node.hasAttribute("data-lastpass-root")) {
      return true;
    }
    if (tag === "iframe" || tag === "frame" || tag === "object" || tag === "embed") {
      const src = node.getAttribute("src") || node.src || "";
      if (typeof src === "string" && src.startsWith("chrome-extension://")) return true;
    }
    return false;
  };
  const sweepForeignExtensionNodes = (root) => {
    if (document.getElementById("__opencode_browser_page_status__")?.getAttribute("data-waiting") === "true") return;
    if (isForeignExtensionNode(root)) {
      root.remove();
      return;
    }
    if (!root || typeof root.querySelectorAll !== "function") return;
    for (const el of root.querySelectorAll("com-1password-notification, com-1password-menu, com-1password-button, [data-onepassword-extension], [data-lastpass-root], iframe[src^='chrome-extension://'], frame[src^='chrome-extension://']")) {
      el.remove();
    }
  };
  const guardExtensionFrames = () => {
    sweepForeignExtensionNodes(document.documentElement);
    const extObserver = new MutationObserver((records) => {
      if (document.getElementById("__opencode_browser_page_status__")?.getAttribute("data-waiting") === "true") return;
      for (const record of records) {
        for (const added of record.addedNodes) {
          sweepForeignExtensionNodes(added);
        }
      }
    });
    extObserver.observe(document.documentElement, { childList: true, subtree: true });
  };
  if (document.documentElement) {
    restoreSavedState();
    guardExtensionFrames();
  } else {
    const observer = new MutationObserver(() => {
      if (!document.documentElement) return;
      observer.disconnect();
      restoreSavedState();
      guardExtensionFrames();
    });
    observer.observe(document, { childList: true });
  }
})();`

export function inputDispatchMouseEventToGhostCursorAction(params: JsonObject | undefined): GhostCursorMouseAction | undefined {
  if (!params) {
    return undefined
  }
  const type = params.type
  if (type !== "mouseMoved" && type !== "mousePressed" && type !== "mouseReleased") {
    return undefined
  }
  if (!Predicate.isNumber(params.x) || !Predicate.isNumber(params.y)) {
    return undefined
  }
  const button = parseButton(params.button)
  return {
    type: Match.value(type).pipe(
      Match.when("mousePressed", () => "down" as const),
      Match.when("mouseReleased", () => "up" as const),
      Match.when("mouseMoved", () => "move" as const),
      Match.exhaustive,
    ),
    x: params.x,
    y: params.y,
    button,
  }
}

export function ghostCursorMouseActionExpression(action: GhostCursorMouseAction): string {
  return `globalThis.__opencodeBrowserGhostCursor?.applyMouseEvent(${JSON.stringify(action)})`
}

export function ghostCursorRestoreExpression(position: { readonly x: number; readonly y: number }): string {
  return `globalThis.__opencodeBrowserGhostCursor?.restore(${JSON.stringify(position)})`
}

async function ensureGhostCursor(page: Page): Promise<void> {
  await page.evaluate(ghostCursorClientSource)
}

async function resolveTargetBox(page: Page, target: Locator | string): Promise<GhostCursorRect | null> {
  const locator = Predicate.isString(target) ? page.locator(target) : target
  return await locator.first().boundingBox()
}

export async function showGhostCursor(options: { readonly page: Page; readonly cursorOptions?: GhostCursorClientOptions }): Promise<void> {
  await ensureGhostCursor(options.page)
  const payload: GhostCursorEvaluatePayload = options.cursorOptions ? { cursorOptions: options.cursorOptions } : {}
  await options.page.evaluate(
    (payload: GhostCursorEvaluatePayload) => {
      const api = (globalThis as { __opencodeBrowserGhostCursor?: GhostCursorBrowserApi }).__opencodeBrowserGhostCursor
      api?.show(payload.cursorOptions)
    },
    payload,
  )
}

export async function hideGhostCursor(options: { readonly page: Page }): Promise<void> {
  await options.page.evaluate(() => {
    const api = (globalThis as { __opencodeBrowserGhostCursor?: GhostCursorBrowserApi }).__opencodeBrowserGhostCursor
    api?.hide()
  })
}

export async function setGhostCursorCaption(options: {
  readonly page: Page
  readonly title: string | null
  readonly captionOptions?: GhostCursorCaptionOptions
}): Promise<void> {
  await ensureGhostCursor(options.page)
  const payload: GhostCursorCaptionPayload | null = options.title
    ? { title: options.title, ...(options.captionOptions ? { options: options.captionOptions } : {}) }
    : null
  await options.page.evaluate((captionPayload: GhostCursorCaptionPayload | null) => {
    const api = (globalThis as { __opencodeBrowserGhostCursor?: GhostCursorBrowserApi }).__opencodeBrowserGhostCursor
    api?.setCaption(captionPayload)
  }, payload)
}

export async function showGhostCursorCallout(options: {
  readonly page: Page
  readonly target: Locator | string
  readonly label: string
  readonly calloutOptions?: GhostCursorCalloutOptions
}): Promise<void> {
  await ensureGhostCursor(options.page)
  const box = await resolveTargetBox(options.page, options.target)
  if (!box) return
  const payload: GhostCursorCalloutPayload = {
    rect: box,
    label: options.label,
    ...(options.calloutOptions ? { options: options.calloutOptions } : {}),
  }
  await options.page.evaluate((calloutPayload: GhostCursorCalloutPayload) => {
    const api = (globalThis as { __opencodeBrowserGhostCursor?: GhostCursorBrowserApi }).__opencodeBrowserGhostCursor
    api?.showCallout(calloutPayload)
  }, payload)
}

export async function clearGhostCursorCallouts(options: { readonly page: Page }): Promise<void> {
  await options.page.evaluate(() => {
    const api = (globalThis as { __opencodeBrowserGhostCursor?: GhostCursorBrowserApi }).__opencodeBrowserGhostCursor
    api?.clearCallouts()
  })
}

export async function zoomGhostCursorCamera(options: {
  readonly page: Page
  readonly target: Locator | string | { readonly x: number; readonly y: number } | null
  readonly zoomOptions?: GhostCursorZoomOptions
}): Promise<void> {
  await ensureGhostCursor(options.page)
  let rect: GhostCursorRect | null = null
  if (options.target !== null) {
    rect = (Predicate.isString(options.target) || "boundingBox" in options.target)
      ? await resolveTargetBox(options.page, options.target)
      : { x: options.target.x, y: options.target.y, width: 1, height: 1 }
  }
  const payload: GhostCursorZoomPayload = {
    rect,
    scale: options.target === null ? 1 : (options.zoomOptions?.scale ?? 1.75),
    durationMs: options.zoomOptions?.durationMs ?? 360,
  }
  await options.page.evaluate(async (zoomPayload: GhostCursorZoomPayload) => {
    const api = (globalThis as { __opencodeBrowserGhostCursor?: GhostCursorBrowserApi }).__opencodeBrowserGhostCursor
    await api?.zoomTo(zoomPayload)
  }, payload)
}

export async function setGhostCursorSpotlight(options: {
  readonly page: Page
  readonly target: Locator | string | null
  readonly spotlightOptions?: GhostCursorSpotlightOptions
}): Promise<void> {
  await ensureGhostCursor(options.page)
  const rect = options.target !== null ? await resolveTargetBox(options.page, options.target) : null
  const payload: GhostCursorSpotlightPayload = {
    rect,
    ...(options.spotlightOptions ? { options: options.spotlightOptions } : {}),
  }
  await options.page.evaluate(async (spotlightPayload: GhostCursorSpotlightPayload) => {
    const api = (globalThis as { __opencodeBrowserGhostCursor?: GhostCursorBrowserApi }).__opencodeBrowserGhostCursor
    await api?.setSpotlight(spotlightPayload)
  }, payload)
}

export async function showGhostCursorKeys(options: {
  readonly page: Page
  readonly keys: string | readonly string[]
  readonly label?: string
}): Promise<void> {
  await ensureGhostCursor(options.page)
  const keys = Predicate.isString(options.keys) ? options.keys.split("+").map((k) => k.trim()).filter(Boolean) : options.keys
  const payload: GhostCursorKeysPayload = {
    keys,
    ...(options.label ? { label: options.label } : {}),
  }
  await options.page.evaluate((keysPayload: GhostCursorKeysPayload) => {
    const api = (globalThis as { __opencodeBrowserGhostCursor?: GhostCursorBrowserApi }).__opencodeBrowserGhostCursor
    api?.showKeys(keysPayload)
  }, payload)
}

function parseButton(value: JsonObject[string] | undefined): GhostCursorMouseAction["button"] {
  if (value === "left" || value === "right" || value === "middle" || value === "none") {
    return value
  }
  return "none"
}
