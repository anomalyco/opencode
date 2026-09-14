import picker from "@brendonovich/vite-plugin-opencode"

export function pickerPlugin() {
  const plugin = picker()
  const client = "/__vite_opencode_picker_client.js"
  return {
    ...plugin,
    resolveId(id: string) {
      return plugin.resolveId(id === client ? "virtual:vite-opencode-picker/client" : id)
    },
    configureServer(server: Parameters<typeof plugin.configureServer>[0]) {
      server.middlewares.use(client, (_request, response) => {
        response.setHeader("content-type", "text/javascript")
        response.end(plugin.load(plugin.resolveId("virtual:vite-opencode-picker/client")!))
      })
      plugin.configureServer(server)
    },
    transformIndexHtml: {
      order: "pre" as const,
      handler() {
        // A real URL stays loadable if bundled dev leaves the HTML import unbundled.
        return [{ tag: "script", attrs: { type: "module", src: client }, injectTo: "body" as const }]
      },
    },
  }
}
