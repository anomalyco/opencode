/**
 * Plugin UI Canvas
 *
 * This is the ONLY approved API for plugins to render UI in OpenCode TUI.
 *
 * ## IMPORTANT: Use lowercase JSX elements
 *
 * Plugins MUST use lowercase JSX elements directly:
 * - `<box>` not `<Box>`
 * - `<text>` not `<Text>`
 *
 * ## Example:
 * ```tsx
 * import { createSignal, For } from "../../src/plugin-ui"
 *
 * const MyComponent = () => {
 *   return (
 *     <box flexDirection="column" gap={0}>
 *       <text fg="#00ff00">Hello!</text>
 *     </box>
 *   )
 * }
 * ```
 *
 * ## Why lowercase?
 * Uppercase components (Box, Text, VStack, HStack) caused "No renderer found" errors because
 * their JSX gets compiled at module load time (outside renderer context).
 * Lowercase elements (<box>, <text>) are intrinsic JSX elements that compile at render time.
 *
 * ## Common Patterns:
 * - Vertical stack: `<box flexDirection="column" gap={1}>`
 * - Horizontal stack: `<box flexDirection="row" gap={1}>`
 * - Text with color: `<text fg="#00ff00">Hello</text>`
 */

/** @jsxImportSource @opentui/solid */

import { createSignal as solidCreateSignal, JSX } from "solid-js"

// Re-export SolidJS primitives (safe for plugins)
export { createSignal, createMemo, For, Show, Switch, Match, onMount, onCleanup } from "solid-js"

// Re-export OpenTUI elements (these are the primitives)
export type { BoxProps, TextProps } from "@opentui/solid"

// Re-export OpenTUI core utilities
export { TextAttributes } from "@opentui/core"

// ============================================================================
// FORM COMPONENTS FOR PLUGINS
// ============================================================================

export interface InputProps {
  value?: string
  placeholder?: string
  disabled?: boolean
  fg?: string
  bg?: string
  onInput?: (value: string) => void
  onChange?: (value: string) => void
  onKeyPress?: (key: string) => void
  onSubmit?: () => void
  width?: number
  maxLength?: number
}

export function Input(props: InputProps): JSX.Element {
  const [focused, setFocused] = solidCreateSignal(false)
  const [cursor, setCursor] = solidCreateSignal(0)
  
  const displayValue = () => props.value || ""
  const displayPlaceholder = () => !displayValue() && props.placeholder
  
  return (
    <box
      flexDirection="row"
      width={props.width || 30}
      height={1}
      bg={props.bg || (focused() ? "#1e293b" : "#0f172a")}
      borderStyle="single"
      borderColor={focused() ? "#3b82f6" : "#334155"}
      paddingX={1}
      onClick={() => setFocused(true)}
      onKeyPress={(e: any) => {
        if (props.disabled) return
        
        if (e.key === "Enter") {
          props.onSubmit?.()
          return
        }
        
        if (e.key === "Escape") {
          setFocused(false)
          return
        }
        
        if (e.key === "Backspace") {
          const newValue = displayValue().slice(0, -1)
          props.onInput?.(newValue)
          props.onChange?.(newValue)
          return
        }
        
        if (e.key?.length === 1) {
          const newValue = displayValue() + e.key
          if (!props.maxLength || newValue.length <= props.maxLength) {
            props.onInput?.(newValue)
            props.onChange?.(newValue)
            props.onKeyPress?.(e.key)
          }
        }
      }}
    >
      <text fg={displayPlaceholder() ? "#64748b" : props.fg || "#e2e8f0"}>
        {displayPlaceholder() ? props.placeholder : displayValue()}
        {focused() && !props.disabled && <text fg="#3b82f6">_</text>}
      </text>
    </box>
  )
}

export interface ButtonProps {
  children?: JSX.Element | string
  onClick?: () => void
  disabled?: boolean
  variant?: "primary" | "secondary" | "danger"
  fg?: string
  bg?: string
  width?: number
}

export function Button(props: ButtonProps): JSX.Element {
  const [hovered, setHovered] = solidCreateSignal(false)
  
  const colors = () => {
    if (props.disabled) {
      return { fg: "#64748b", bg: "#1e293b" }
    }
    
    switch (props.variant) {
      case "danger":
        return { 
          fg: hovered() ? "#ffffff" : "#fecaca",
          bg: hovered() ? "#dc2626" : "#7f1d1d"
        }
      case "secondary":
        return {
          fg: hovered() ? "#ffffff" : "#cbd5e1",
          bg: hovered() ? "#475569" : "#334155"
        }
      default: // primary
        return {
          fg: hovered() ? "#ffffff" : "#bfdbfe",
          bg: hovered() ? "#2563eb" : "#1e40af"
        }
    }
  }
  
  return (
    <box
      flexDirection="row"
      height={1}
      width={props.width}
      bg={props.bg || colors().bg}
      borderStyle="single"
      borderColor={hovered() ? "#60a5fa" : "#334155"}
      paddingX={2}
      justifyContent="center"
      alignItems="center"
      onClick={() => {
        if (!props.disabled) props.onClick?.()
      }}
      onMouseOver={() => setHovered(true)}
      onMouseOut={() => setHovered(false)}
    >
      <text fg={props.fg || colors().fg}>{props.children}</text>
    </box>
  )
}

export interface CheckboxProps {
  checked?: boolean
  label?: string
  disabled?: boolean
  onChange?: (checked: boolean) => void
  fg?: string
}

export function Checkbox(props: CheckboxProps): JSX.Element {
  return (
    <box
      flexDirection="row"
      gap={1}
      onClick={() => {
        if (!props.disabled) {
          props.onChange?.(!props.checked)
        }
      }}
    >
      <text fg={props.fg || "#3b82f6"}>
        [{props.checked ? "✓" : " "}]
      </text>
      {props.label && (
        <text fg={props.disabled ? "#64748b" : "#e2e8f0"}>
          {props.label}
        </text>
      )}
    </box>
  )
}

export interface SelectOption {
  label: string
  value: string | number
  disabled?: boolean
}

export interface SelectProps {
  value?: string | number
  options: SelectOption[]
  onChange?: (value: string | number) => void
  disabled?: boolean
  placeholder?: string
  fg?: string
  bg?: string
  width?: number
}

export function Select(props: SelectProps): JSX.Element {
  const [open, setOpen] = solidCreateSignal(false)
  const [hoverIndex, setHoverIndex] = solidCreateSignal(0)
  
  const selectedOption = () => 
    props.options.find(opt => opt.value === props.value)
  
  const displayText = () => 
    selectedOption()?.label || props.placeholder || "Select..."
  
  return (
    <box flexDirection="column" width={props.width || 30}>
      {/* Select trigger */}
      <box
        flexDirection="row"
        height={1}
        bg={props.bg || "#0f172a"}
        borderStyle="single"
        borderColor={open() ? "#3b82f6" : "#334155"}
        paddingX={1}
        onClick={() => !props.disabled && setOpen(!open())}
      >
        <text fg={props.fg || "#e2e8f0"} flexGrow={1}>
          {displayText()}
        </text>
        <text fg="#64748b">{open() ? "▲" : "▼"}</text>
      </box>
      
      {/* Dropdown */}
      {open() && (
        <box
          flexDirection="column"
          bg="#1e293b"
          borderStyle="single"
          borderColor="#334155"
          maxHeight={10}
        >
          <For each={props.options}>
            {(option, index) => (
              <box
                flexDirection="row"
                height={1}
                paddingX={1}
                bg={hoverIndex() === index() ? "#334155" : undefined}
                onClick={() => {
                  if (!option.disabled) {
                    props.onChange?.(option.value)
                    setOpen(false)
                  }
                }}
                onMouseOver={() => setHoverIndex(index())}
              >
                <text fg={option.disabled ? "#64748b" : "#e2e8f0"}>
                  {option.value === props.value && "✓ "}
                  {option.label}
                </text>
              </box>
            )}
          </For>
        </box>
      )}
    </box>
  )
}
