import { Keymap, type KeymapHost } from "@opentui/keymap"
import {
  registerBackspacePopsPendingSequence,
  registerDefaultBindingParser,
  registerEscapeClearsPendingSequence,
  registerTimedLeader,
} from "@opentui/keymap/addons"
import { createHtmlKeymapHost, type HtmlKeymapEvent } from "@opentui/keymap/html"
import type { CommandOption } from "./command"

export const IS_MAC = typeof navigator !== "undefined" && /(Mac|iPod|iPhone|iPad)/.test(navigator.platform)

export type AppKeymap = Keymap<HTMLElement, HtmlKeymapEvent>

/** Stands for the leader key. It may only start a chord: `<leader> g s`. */
export const LEADER = "<leader>"

const LEADER_TIMEOUT_MS = 2000

/**
 * Splits one combo of a keybind into its chord strokes: `mod+k mod+c` into two, `<leader> n` into the leader and `n`.
 * `<leader>n` without a space is accepted too.
 */
export function chordStrokes(combo: string) {
  return combo
    .trim()
    .replace(/^<leader>(?=\S)/i, `${LEADER} `)
    .split(/\s+/)
    .filter(Boolean)
}

/** Whether a combo is a chord the keymap accepts: no empty strokes, and `<leader>` only as its first stroke. */
export function validChord(combo: string) {
  const strokes = chordStrokes(combo)

  return strokes.length > 0 && strokes.every((stroke, index) => (stroke.toLowerCase() === LEADER ? index === 0 : true))
}

/**
 * The keymap behind every command keybind. It reads keys in the capture phase on the document root, before the
 * focused element sees them.
 */
export function createAppKeymap(input: { blocked: () => boolean; editable: (target: EventTarget | null) => boolean }) {
  const host = createAppKeymapHost(document.documentElement, input.blocked)
  const keymap: AppKeymap = new Keymap(host.host)
  // Every binding is written by `keymapKey`: strokes separated by spaces, each a `+`-joined combo.
  keymap.prependBindingParser((ctx) => {
    if (ctx.index !== 0) return
    const leader = ctx.tokens.get("leader")

    const parts = ctx.input
      .trim()
      .split(/\s+/)
      .map((stroke) =>
        stroke === LEADER
          ? leader
            ? ctx.parseObjectKey(leader.stroke, { display: LEADER, match: leader.match, tokenName: "leader" })
            : undefined
          : ctx.parseObjectKey(strokeInput(stroke), { display: stroke }),
      )

    if (parts.some((part) => !part)) return { parts: [], nextIndex: ctx.input.length, unknownTokens: ["leader"] }

    return {
      parts: parts.filter((part) => part !== undefined),
      nextIndex: ctx.input.length,
      usedTokens: ctx.input.includes(LEADER) ? ["leader"] : [],
    }
  })
  registerDefaultBindingParser(keymap)
  keymap.prependEventMatchResolver((event, ctx) => {
    const original = event.originalEvent

    if (!original) return

    const name = keymapKeyName(keyFromKeyboardEvent(original))
    const alias = KEY_ALIASES.get(name)

    const stroke = {
      name,
      ctrl: original.ctrlKey,
      shift: original.shiftKey,
      meta: original.altKey,
      super: original.metaKey,
    }

    return (alias ? [name, alias] : [name]).flatMap((name) => [
      ctx.resolveKey({ ...stroke, name }),
      // `shift+/` types `?`, so `?` binds the symbol whichever modifier the layout needs.
      ...(stroke.shift && name.length === 1 && !/^[a-z0-9]$/.test(name)
        ? [ctx.resolveKey({ ...stroke, name, shift: false })]
        : []),
    ])
  })
  // A binding whose first key types a character stays out of text fields, so typing never starts a sequence.
  keymap.registerBindingFields({
    outsideText(value, ctx) {
      if (value === true) ctx.activeWhen(() => !input.editable(document.activeElement))
    },
  })
  registerEscapeClearsPendingSequence(keymap)
  registerBackspacePopsPendingSequence(keymap)

  return { keymap, destroy: host.destroy }
}

/**
 * Registers the keybinds of `options`: one global layer, plus one layer per focus target, which wins over the global
 * one while focus is inside it. On the same keys a command with a `when` comes first, then a user's own binding, then
 * the order given. A command declines a key by returning false from `onSelect`, or through `when` and `skip`; the key
 * then goes to the next command, and finally to the focused element.
 */
export function registerCommandLayers(
  keymap: AppKeymap,
  options: CommandOption[],
  custom: (id: string) => boolean,
  leader: boolean,
) {
  const layers = new Map<HTMLElement | undefined, CommandOption[]>()

  options
    .map((option, index) => ({ option, index, rank: (option.when ? 2 : 0) + (custom(option.id) ? 1 : 0) }))
    .sort((a, b) => b.rank - a.rank || a.index - b.index)
    .forEach(({ option }) => {
      if (!option.keybind) return
      const target = option.target?.()

      if (option.target && !target) return
      layers.set(target, [...(layers.get(target) ?? []), option])
    })

  const disposers = Array.from(layers, ([target, options]) =>
    keymap.registerLayer({
      target,
      priority: target ? 1 : 0,
      commands: options.map((option) => ({
        name: option.id,
        run(ctx) {
          const event = ctx.event.originalEvent

          if (event && option.skip?.(event)) return false

          if (event && option.when && !option.when(event)) return false

          return option.onSelect?.("keybind") !== false
        },
      })),
      bindings: options.flatMap((option) =>
        option
          .keybind!.split(",")
          .map((combo) => combo.trim())
          .filter((combo) => combo && combo !== "none" && validChord(combo))
          // Without a leader key the `<leader>` chords stay listed but do nothing.
          .filter((combo) => leader || chordStrokes(combo)[0]?.toLowerCase() !== LEADER)
          .map((combo) => {
            const key = keymapKey(combo)

            return { key, cmd: option.id, outsideText: !option.editable && typesCharacter(keymap, key) }
          }),
      ),
    }),
  )

  return () => disposers.forEach((dispose) => dispose())
}

export function registerAppLeader(keymap: AppKeymap, trigger: string) {
  return registerTimedLeader(keymap, { trigger: keymapKey(trigger), timeoutMs: LEADER_TIMEOUT_MS })
}

/** Translates one combo of the app's keybind syntax (`mod+shift+arrowup`, `<leader> g s`) into the keymap's. */
export function keymapKey(combo: string) {
  return chordStrokes(combo)
    .map((stroke) =>
      stroke.toLowerCase() === LEADER
        ? LEADER
        : stroke
            .split("+")
            .map((part) => {
              const lower = part.toLowerCase()

              if (lower === "mod") return IS_MAC ? "super" : "ctrl"

              if (lower === "meta" || lower === "cmd" || lower === "command") return "super"

              return MODIFIER_PARTS.has(lower) ? lower : keymapKeyName(lower)
            })
            .join("+"),
    )
    .join(" ")
}

// One stroke as `keymapKey` writes it, such as `super+shift+[`.
function strokeInput(stroke: string) {
  const parts = stroke.split("+")
  const has = (...names: string[]) => parts.some((part) => names.includes(part))

  return {
    name: parts.findLast((part) => !MODIFIER_PARTS.has(part)) ?? parts.at(-1)!,
    ctrl: has("ctrl", "control"),
    shift: has("shift"),
    meta: has("alt", "option"),
    super: has("super"),
    hyper: has("hyper") || undefined,
  }
}

/** Whether the first key of a keymap sequence types a character, so it should stay out of text fields. */
export function typesCharacter(keymap: AppKeymap, key: string) {
  const first = keymap.parseKeySequence(key)[0]?.stroke

  if (!first) return false

  return !first.ctrl && !first.meta && !first.super && first.name !== "tab"
}

export function keyFromKeyboardEvent(event: KeyboardEvent) {
  const key = normalizeKey(physicalKey(event))

  if (!event.altKey || /^[a-z0-9]$/.test(key)) return key

  if (!event.code.startsWith("Key") || event.code.length !== 4) return key

  return event.code.slice(3).toLowerCase()
}

const MODIFIER_PARTS = new Set(["ctrl", "control", "shift", "alt", "option", "super", "hyper"])

const KEY_NAMES = new Map([
  ["arrowup", "up"],
  ["arrowdown", "down"],
  ["arrowleft", "left"],
  ["arrowright", "right"],
  ["esc", "escape"],
  ["enter", "return"],
])

// The app writes these keys by name and the keymap parser reads both forms, so events resolve to each.
const KEY_ALIASES = new Map([
  ["comma", ","],
  ["plus", "+"],
])

function keymapKeyName(key: string) {
  return KEY_NAMES.get(key) ?? key
}

function normalizeKey(key: string) {
  if (key === ",") return "comma"

  if (key === "+") return "plus"

  if (key === " ") return "space"

  return key.toLowerCase()
}

// ⇧[ types { and ⌥. types ≥ on US layouts. Keep ASCII layout mappings; non-ASCII falls back to the physical key.
function physicalKey(event: Pick<KeyboardEvent, "key" | "code">) {
  if (event.key === "{" || event.key === "}") return event.key === "{" ? "[" : "]"

  if (!/^[^\x00-\x7f]$/u.test(event.key)) return event.key

  if (event.code === "BracketLeft") return "["

  if (event.code === "BracketRight") return "]"

  if (event.code === "Period") return "."

  return event.key
}

// The HTML host, except that it drops keys while an IME composes or while command keybinds are blocked, and that
// its owner can destroy it, which disposes the keymap.
function createAppKeymapHost(root: HTMLElement, blocked: () => boolean) {
  const host = createHtmlKeymapHost(root)
  const destroyed = new Set<() => void>()
  const state = { destroyed: false }

  const keymapHost: KeymapHost<HTMLElement, HtmlKeymapEvent> = {
    metadata: host.metadata,
    rootTarget: host.rootTarget,
    get isDestroyed() {
      return state.destroyed
    },
    onDestroy(listener) {
      destroyed.add(listener)

      return () => destroyed.delete(listener)
    },
    getFocusedTarget: () => host.getFocusedTarget(),
    getParentTarget: (target) => host.getParentTarget(target),
    isTargetDestroyed: (target) => host.isTargetDestroyed(target),
    onKeyPress: (listener) =>
      host.onKeyPress((event) => {
        const original = event.originalEvent

        // Escape, Enter and Tab confirm or cancel IME candidates; Safari can report them as keyCode 229.
        if (original && (original.isComposing || original.keyCode === 229)) return

        if (blocked()) return

        listener(event)
      }),
    onKeyRelease: (listener) => host.onKeyRelease(listener),
    onFocusChange: (listener) => host.onFocusChange(listener),
    onTargetDestroy: (target, listener) => host.onTargetDestroy(target, listener),
    createCommandEvent: () => host.createCommandEvent(),
  }

  return {
    host: keymapHost,
    destroy() {
      if (state.destroyed) return
      state.destroyed = true
      destroyed.forEach((listener) => listener())
    },
  }
}
