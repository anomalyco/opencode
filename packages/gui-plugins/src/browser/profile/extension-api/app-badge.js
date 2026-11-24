// Runs in every frame and service worker of the profile's partition, before the page's own script. Chromium gives
// each of them `navigator.setAppBadge` and `clearAppBadge`, and Electron draws what they ask for on the app's
// taskbar button, Dock icon or launcher entry without telling main, over the count the app shows there. A site is not
// the app, so here both resolve and draw nothing, as they do in a browser tab. A frame's initial empty document gets
// no preload (Electron has nothing to run one with), so a page that reaches into such a frame for its `navigator`
// still draws.
{
  // Runs in the page's own world, so it must not use anything from this file's scope.
  const ignore = () => {
    const prototype = Object.getPrototypeOf(globalThis.navigator)

    // Only a secure context has the badge.
    if (prototype.setAppBadge) Object.assign(prototype, { async setAppBadge() {}, async clearAppBadge() {} })
  }

  // Manifest V2 background pages run without context isolation, so this shares their world.
  if (process.contextIsolated === false) ignore()
  else require("electron").contextBridge.executeInMainWorld({ func: ignore })
}
