import { protocol } from "electron"

export const rendererProtocol = "oc"
export const rendererHost = "renderer"

// Scheme privileges can only be granted before the app is ready, so the entry module calls this
// before it loads anything else.
export function registerRendererScheme() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: rendererProtocol,
      privileges: {
        secure: true,
        standard: true,
        supportFetchAPI: true,
        stream: true,
        // Let Chromium keep V8 bytecode for the renderer bundle between launches.
        codeCache: true,
      },
    },
  ])
}
