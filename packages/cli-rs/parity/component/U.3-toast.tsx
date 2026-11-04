/** @jsxImportSource @opentui/solid */
// P-COMP fixtures for the toast (packages/tui/src/ui/toast.tsx): crates/ui/tests/dialogs.rs. "U.3/toast-theme" is
// the theme error toast (component/theme-error-toast.tsx); "U.3/toast" has no title and a message that wraps.
import { onMount } from "solid-js"
import { Toast, useToast, type ToastOptions } from "../../../tui/src/ui/toast"
import { renderComponent } from "../lib/component"

function Show(props: { toasts: Omit<ToastOptions, "duration">[] }) {
  const toast = useToast()
  onMount(() => props.toasts.forEach((item) => toast.show(item)))
  return <Toast />
}

await renderComponent({
  fixture: "U.3/toast-theme",
  width: 70,
  height: 12,
  element: () => (
    <Show
      toasts={[
        {
          variant: "error",
          title: "Failed to load theme: mine",
          message: "Color reference \"missing\" not found in defs or theme",
        },
      ]}
    />
  ),
  ready: (frame) => frame.includes("defs"),
})

await renderComponent({
  fixture: "U.3/toast",
  width: 50,
  height: 10,
  element: () => (
    <Show toasts={[{ variant: "success", message: "Copied the session link to the clipboard so you can share it" }]} />
  ),
  ready: (frame) => frame.includes("Copied"),
})
