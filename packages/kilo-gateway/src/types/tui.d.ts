/**
 * Type declarations for OpenCode TUI runtime modules
 * These modules are provided at runtime by the OpenCode TUI system
 */

declare module "@tui/component/dialog-command" {
  export function useCommandDialog(): any
}

declare module "@tui/context/sync" {
  export function useSync(): any
}

declare module "@tui/ui/dialog" {
  export function useDialog(): any
}

declare module "@tui/ui/toast" {
  export function useToast(): any
}

declare module "@tui/ui/dialog-alert" {
  export const DialogAlert: any
}

declare module "@tui/ui/dialog-select" {
  export const DialogSelect: any
}

declare module "@tui/ui/link" {
  export const Link: any
}

declare module "@tui/util/clipboard" {
  export const Clipboard: any
}

declare module "@opentui/core" {
  export const TextAttributes: any
}

declare module "@opentui/solid" {
  export function useKeyboard(handler: (evt: any) => void): void
}

// OpenTUI JSX intrinsic elements
declare namespace JSX {
  interface IntrinsicElements {
    box: any
    text: any
    span: any
    scrollbox: any
  }
}
