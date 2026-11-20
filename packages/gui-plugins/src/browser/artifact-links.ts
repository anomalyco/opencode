import type { Cdp } from "./cdp"
import { destinationOrigin } from "./policy"

/** UX only: the native navigation fence and the document's network allowlist do not depend on this script. */
export function artifactLinks(cdp: Cdp, current: () => string | undefined, offer: (url: string) => void) {
  const world = "opencode-artifact-links"
  const binding = "openCodeArtifactLink"
  const installed = new Map<string, Promise<void>>()
  let ready: Promise<void> | undefined

  cdp.on("Runtime.bindingCalled", (event, sessionID) => {
    if (
      !sessionID &&
      current() &&
      event.name === binding &&
      event.payload.length <= 16384 &&
      destinationOrigin(event.payload)
    )
      offer(event.payload)
  })

  return (host: string) => {
    const prior = installed.get(host)

    if (prior) return prior
    ready ??= cdp.send("Runtime.addBinding", { name: binding, executionContextName: world }).then(() => undefined)

    const install = ready
      .then(() =>
        cdp.send("Page.addScriptToEvaluateOnNewDocument", {
          worldName: world,
          runImmediately: true,
          source: `
      if (location.protocol === 'oc-preview:' && location.host === ${JSON.stringify(host)}) {
        const external = value => { try { return /^https?:$/.test(new URL(value).protocol) } catch { return false } };
        addEventListener('click', event => {
          const url = event.composedPath().find(node => node instanceof HTMLAnchorElement)?.href;
          if (!url || !external(url)) return;
          event.preventDefault();
          if (event.isTrusted) ${binding}(url);
        }, true);
        navigation.addEventListener('navigate', event => {
          if (event.cancelable && external(event.destination.url)) event.preventDefault();
        });
      }
    `,
        }),
      )
      .then(() => undefined)

    installed.set(host, install)

    return install
  }
}
