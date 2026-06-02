import { Effect, Schema } from "effect"
import * as Tool from "../../tool/tool"
import { engine } from "./engine"
import { ObserveParameters } from "./schema"

export const ObserveTool = Tool.define(
  "browser_observe",
  Effect.gen(function* () {
    return {
      description:
        "Unified browser content extraction tool. Supports snapshot, screenshot, text, html, links, tables, and forms actions.",
      parameters: ObserveParameters,
      execute: (params: Schema.Schema.Type<typeof ObserveParameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: "browser",
            patterns: [],
            always: ["*"],
            metadata: { action: params.action },
          })

          const page: any = yield* Effect.promise(() => engine.ensurePage(ctx.sessionID))

          switch (params.action) {
            case "snapshot": {
              const content: string = params.selector
                ? yield* Effect.promise<string>(() => page.locator(params.selector).innerHTML())
                : yield* Effect.promise<string>(() => page.content())
              const truncated =
                content.length > 10000 ? content.slice(0, 10000) + "\n... (truncated)" : content
              return { title: "Page snapshot", output: truncated, metadata: {} }
            }
            case "screenshot": {
              const buffer: Buffer = params.selector
                ? yield* Effect.promise<Buffer>(() => page.locator(params.selector).screenshot())
                : yield* Effect.promise<Buffer>(() =>
                    page.screenshot({ fullPage: params.fullPage ?? false, type: "png" })
                  )
              const dataUrl = `data:image/png;base64,${buffer.toString("base64")}`
              return { title: "Page screenshot", output: dataUrl, metadata: {} }
            }
            case "text": {
              const text: string = params.selector
                ? yield* Effect.promise<string>(() => page.locator(params.selector).innerText())
                : yield* Effect.promise<string>(() => page.locator("body").innerText())
              const truncated =
                text.length > 10000 ? text.slice(0, 10000) + "\n... (truncated)" : text
              return { title: "Page text", output: truncated, metadata: {} }
            }
            case "html": {
              const content: string = yield* Effect.promise<string>(() => page.content())
              const truncated =
                content.length > 10000 ? content.slice(0, 10000) + "\n... (truncated)" : content
              return { title: "Page HTML", output: truncated, metadata: {} }
            }
            case "links": {
              const links: Array<{ text: string | null; href: string }> =
                yield* Effect.promise<Array<{ text: string | null; href: string }>>(() =>
                  page.$$eval("a[href]", (els: any[]) =>
                    els.map((a: any) => ({
                      text: a.textContent?.trim() ?? null,
                      href: a.href,
                    }))
                  )
                )
              const formatted = links
                .map((link) => `- [${link.text ?? "(no text)"}](${link.href})`)
                .join("\n")
              return { title: "Page links", output: formatted, metadata: {} }
            }
            case "tables": {
              const tables: Array<{ rows: number; cols: number; html: string }> =
                yield* Effect.promise<Array<{ rows: number; cols: number; html: string }>>(() =>
                  page.$$eval("table", (tables: any[]) =>
                    tables.map((t: any) => ({
                      rows: t.rows.length,
                      cols: t.rows[0]?.cells.length ?? 0,
                      html: t.outerHTML.slice(0, 2000),
                    }))
                  )
                )
              return {
                title: "Page tables",
                output: JSON.stringify(tables, null, 2),
                metadata: {},
              }
            }
            case "forms": {
              const forms: Array<{
                action: string
                method: string
                fields: Array<{ name: string; type: string; tag: string }>
              }> = yield* Effect.promise<
                Array<{
                  action: string
                  method: string
                  fields: Array<{ name: string; type: string; tag: string }>
                }>
              >(() =>
                page.$$eval("form", (forms: any[]) =>
                  forms.map((f: any) => ({
                    action: f.action,
                    method: f.method,
                    fields: [...f.elements].map((e: any) => ({
                      name: e.name,
                      type: e.type,
                      tag: e.tagName,
                    })),
                  }))
                )
              )
              return {
                title: "Page forms",
                output: JSON.stringify(forms, null, 2),
                metadata: {},
              }
            }
          }
        }).pipe(Effect.orDie),
    }
  }),
)