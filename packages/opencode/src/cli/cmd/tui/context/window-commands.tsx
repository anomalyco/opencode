// packages/opencode/src/cli/cmd/tui/context/window-commands.tsx
import { useKeyboard } from "@opentui/solid"
import { createSimpleContext } from "./helper"
import { useKeybind } from "./keybind"
import { useLayout } from "./layout"
import { useExit } from "./exit"

export const { use: useWindowCommands, provider: WindowCommandsProvider } = createSimpleContext({
  name: "WindowCommands",
  init: () => {
    const keybind = useKeybind()
    const layout = useLayout()
    const exit = useExit()

    useKeyboard((evt) => {
      // Focus navigation
      if (keybind.match("window_focus_left", evt)) {
        layout.focusDirection("left")
        return
      }
      if (keybind.match("window_focus_down", evt)) {
        layout.focusDirection("down")
        return
      }
      if (keybind.match("window_focus_up", evt)) {
        layout.focusDirection("up")
        return
      }
      if (keybind.match("window_focus_right", evt)) {
        layout.focusDirection("right")
        return
      }

      // Split commands
      if (keybind.match("window_split_horizontal", evt)) {
        const focused = layout.focusedWindow
        if (focused) {
          layout.splitHorizontal(focused.viewID)
        }
        return
      }
      if (keybind.match("window_split_vertical", evt)) {
        const focused = layout.focusedWindow
        if (focused) {
          layout.splitVertical(focused.viewID)
        }
        return
      }

      // Close commands
      if (keybind.match("window_close", evt)) {
        const closed = layout.closeWindow()
        if (!closed) {
          exit()
        }
        return
      }
      if (keybind.match("window_close_others", evt)) {
        layout.closeOtherWindows()
        return
      }

      // Resize commands
      if (keybind.match("window_equalize", evt)) {
        layout.equalizeWindows()
        return
      }
      if (keybind.match("window_increase_height", evt)) {
        layout.resizeWindow(1, "height")
        return
      }
      if (keybind.match("window_decrease_height", evt)) {
        layout.resizeWindow(-1, "height")
        return
      }
      if (keybind.match("window_increase_width", evt)) {
        layout.resizeWindow(1, "width")
        return
      }
      if (keybind.match("window_decrease_width", evt)) {
        layout.resizeWindow(-1, "width")
        return
      }
    })

    return {}
  },
})
