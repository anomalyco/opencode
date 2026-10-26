import { app, BrowserWindow, systemPreferences } from "electron"
import { Effect } from "effect"
import { WindowRpcs } from "../../shared/ipc-rpc"
import { IpcPortHandoff } from "../ipc-transport"
import {
  getPinchZoomEnabled,
  setPinchZoomEnabled,
  setTitlebar,
  setTrafficLightsPosition,
  setWindowThemeReady,
  updateTitlebar,
} from "../windows"
import { focusWindow, showWindow } from "../windows/focus"
import { sender } from "./context"

export const windowHandlers = WindowRpcs.toLayer(
  Effect.gen(function* () {
    const handoff = yield* IpcPortHandoff

    return WindowRpcs.of({
      WindowRequestMicrophone: () =>
        Effect.promise(() =>
          process.platform === "darwin" ? systemPreferences.askForMediaAccess("microphone") : Promise.resolve(true),
        ),
      WindowSetVoiceCallActive: ({ active }, context) =>
        Effect.sync(() => {
          sender(handoff, context).setBackgroundThrottling(!active)
        }),
      WindowThemeReady: (_args, context) =>
        Effect.sync(() => {
          const win = BrowserWindow.fromWebContents(sender(handoff, context))

          if (!win) throw new Error("Window not found")
          setWindowThemeReady(win)
        }),
      WindowGetFocused: (_args, context) =>
        Effect.sync(() => BrowserWindow.fromWebContents(sender(handoff, context))?.isFocused() ?? false),
      WindowGetFullscreen: (_args, context) =>
        Effect.sync(() => BrowserWindow.fromWebContents(sender(handoff, context))?.isFullScreen() ?? false),
      WindowSetFocus: (_args, context) =>
        Effect.sync(() => focusWindow(BrowserWindow.fromWebContents(sender(handoff, context)), app)),
      WindowShow: (_args, context) =>
        Effect.sync(() => showWindow(BrowserWindow.fromWebContents(sender(handoff, context)))),
      WindowGetZoomFactor: (_args, context) => Effect.sync(() => sender(handoff, context).getZoomFactor()),
      WindowSetZoomFactor: ({ factor }, context) =>
        Effect.sync(() => {
          const contents = sender(handoff, context)
          contents.setZoomFactor(factor)
          const win = BrowserWindow.fromWebContents(contents)

          if (win) updateTitlebar(win)
        }),
      WindowGetPinchZoomEnabled: () => Effect.sync(getPinchZoomEnabled),
      WindowSetPinchZoomEnabled: ({ enabled }) => Effect.sync(() => setPinchZoomEnabled(enabled)),
      WindowSetTitlebar: ({ theme }, context) =>
        Effect.sync(() => {
          const win = BrowserWindow.fromWebContents(sender(handoff, context))

          if (win) setTitlebar(win, theme)
        }),
      WindowSetTrafficLightsPosition: (position, context) =>
        Effect.sync(() => {
          const win = BrowserWindow.fromWebContents(sender(handoff, context))

          if (win) setTrafficLightsPosition(win, position)
        }),
    })
  }),
)
