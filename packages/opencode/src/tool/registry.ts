import { QuestionTool } from "./question"
import { BashTool } from "./bash"
import { EditTool } from "./edit"
import { GlobTool } from "./glob"
import { GrepTool } from "./grep"
import { BatchTool } from "./batch"
import { ReadTool } from "./read"
import { TaskTool } from "./task"
import { TodoWriteTool, TodoReadTool } from "./todo"
import { WebFetchTool } from "./webfetch"
import { WriteTool } from "./write"
import { InvalidTool } from "./invalid"
import { SkillTool } from "./skill"
import type { Agent } from "../agent/agent"
import { Tool } from "./tool"
import { Instance } from "../project/instance"
import { Config } from "../config/config"
import path from "path"
import { type ToolDefinition } from "@opencode-ai/plugin"
import z from "zod"
import { Plugin } from "../plugin"
import { WebSearchTool } from "./websearch"
import { CodeSearchTool } from "./codesearch"
import { Flag } from "@/flag/flag"
import { Log } from "@/util/log"
import { LspTool } from "./lsp"
import { Truncate } from "./truncation"
import { PlanExitTool, PlanEnterTool } from "./plan"
import { BrowserNavigateTool } from "../browser/navigate"
import { BrowserClickTool } from "../browser/click"
import { BrowserFillTool } from "../browser/fill"
import { BrowserScreenshotTool } from "../browser/screenshot"
import { BrowserEvaluateTool } from "../browser/evaluate"
import { BrowserCloseTool } from "../browser/close"
import { BrowserUrlsTool } from "../browser/urls"
import { BrowserSetTool } from "../browser/browser"
import { BrowserOpenTool } from "../browser/open"
import { BrowserHeadedTool } from "../browser/headed"
import { BrowserSwitchTabTool } from "../browser/switchTab"
import { BrowserCloseTabTool } from "../browser/closeTab"
import { BrowserDuplicateTabTool } from "../browser/duplicateTab"
import { BrowserReopenTabTool } from "../browser/reopenTab"
import { BrowserHoverTool } from "../browser/hover"
import { BrowserRightClickTool } from "../browser/rightClick"
import { BrowserDoubleClickTool } from "../browser/doubleClick"
import { BrowserDragDropTool } from "../browser/dragDrop"
import { BrowserScrollTool } from "../browser/scroll"
import { BrowserScrollToTool } from "../browser/scrollTo"
import { BrowserScrollTopTool } from "../browser/scrollTop"
import { BrowserScrollBottomTool } from "../browser/scrollBottom"
import { BrowserCheckTool } from "../browser/check"
import { BrowserSelectTool } from "../browser/select"
import { BrowserClearTool } from "../browser/clear"
import { BrowserGetValueTool } from "../browser/getValue"
import { BrowserBackTool } from "../browser/back"
import { BrowserForwardTool } from "../browser/forward"
import { BrowserRefreshTool } from "../browser/refresh"
import { BrowserWaitForElementTool } from "../browser/waitForElement"
import { BrowserWaitForURLTool } from "../browser/waitForURL"
import { BrowserGetTextTool } from "../browser/getText"
import { BrowserGetAttributeTool } from "../browser/getAttribute"
import { BrowserGetCSSTool } from "../browser/getCSS"
import { BrowserGetPageSourceTool } from "../browser/getPageSource"
import { BrowserGetCookiesTool } from "../browser/getCookies"
import { BrowserSetCookieTool } from "../browser/setCookie"
import { BrowserDeleteCookieTool } from "../browser/deleteCookie"
import { BrowserGetLocalStorageTool } from "../browser/getLocalStorage"
import { BrowserSetLocalStorageTool } from "../browser/setLocalStorage"
import { BrowserClearStorageTool } from "../browser/clearStorage"
import { BrowserSetViewportTool } from "../browser/setViewport"
import { BrowserSetUserAgentTool } from "../browser/setUserAgent"
import { BrowserSetGeolocationTool } from "../browser/setGeolocation"
import { BrowserSetTimezoneTool } from "../browser/setTimezone"
import { BrowserAssertTextTool } from "../browser/assertText"
import { BrowserAssertVisibleTool } from "../browser/assertVisible"
import { BrowserAssertURLTool } from "../browser/assertURL"

export namespace ToolRegistry {
  const log = Log.create({ service: "tool.registry" })

  export const state = Instance.state(async () => {
    const custom = [] as Tool.Info[]
    const glob = new Bun.Glob("{tool,tools}/*.{js,ts}")

    for (const dir of await Config.directories()) {
      for await (const match of glob.scan({
        cwd: dir,
        absolute: true,
        followSymlinks: true,
        dot: true,
      })) {
        const namespace = path.basename(match, path.extname(match))
        const mod = await import(match)
        for (const [id, def] of Object.entries<ToolDefinition>(mod)) {
          custom.push(fromPlugin(id === "default" ? namespace : `${namespace}_${id}`, def))
        }
      }
    }

    const plugins = await Plugin.list()
    for (const plugin of plugins) {
      for (const [id, def] of Object.entries(plugin.tool ?? {})) {
        custom.push(fromPlugin(id, def))
      }
    }

    return { custom }
  })

  function fromPlugin(id: string, def: ToolDefinition): Tool.Info {
    return {
      id,
      init: async (initCtx) => ({
        parameters: z.object(def.args),
        description: def.description,
        execute: async (args, ctx) => {
          const result = await def.execute(args as any, ctx)
          const out = await Truncate.output(result, {}, initCtx?.agent)
          return {
            title: "",
            output: out.truncated ? out.content : result,
            metadata: { truncated: out.truncated, outputPath: out.truncated ? out.outputPath : undefined },
          }
        },
      }),
    }
  }

  export async function register(tool: Tool.Info) {
    const { custom } = await state()
    const idx = custom.findIndex((t) => t.id === tool.id)
    if (idx >= 0) {
      custom.splice(idx, 1, tool)
      return
    }
    custom.push(tool)
  }

  async function all(): Promise<Tool.Info[]> {
    const custom = await state().then((x) => x.custom)
    const config = await Config.get()

    return [
      InvalidTool,
      ...(["app", "cli", "desktop"].includes(Flag.OPENCODE_CLIENT) ? [QuestionTool] : []),
      BashTool,
      ReadTool,
      GlobTool,
      GrepTool,
      EditTool,
      WriteTool,
      TaskTool,
      WebFetchTool,
      TodoWriteTool,
      TodoReadTool,
      WebSearchTool,
      CodeSearchTool,
      SkillTool,
      BrowserNavigateTool,
      BrowserClickTool,
      BrowserFillTool,
      BrowserScreenshotTool,
      BrowserEvaluateTool,
      BrowserUrlsTool,
      BrowserCloseTool,
      BrowserSetTool,
      BrowserOpenTool,
      BrowserHeadedTool,
      BrowserSwitchTabTool,
      BrowserCloseTabTool,
      BrowserDuplicateTabTool,
      BrowserReopenTabTool,
      BrowserHoverTool,
      BrowserRightClickTool,
      BrowserDoubleClickTool,
      BrowserDragDropTool,
      BrowserScrollTool,
      BrowserScrollToTool,
      BrowserScrollTopTool,
      BrowserScrollBottomTool,
      BrowserCheckTool,
      BrowserSelectTool,
      BrowserClearTool,
      BrowserGetValueTool,
      BrowserBackTool,
      BrowserForwardTool,
      BrowserRefreshTool,
      BrowserWaitForElementTool,
      BrowserWaitForURLTool,
      BrowserGetTextTool,
      BrowserGetAttributeTool,
      BrowserGetCSSTool,
      BrowserGetPageSourceTool,
      BrowserGetCookiesTool,
      BrowserSetCookieTool,
      BrowserDeleteCookieTool,
      BrowserGetLocalStorageTool,
      BrowserSetLocalStorageTool,
      BrowserClearStorageTool,
      BrowserSetViewportTool,
      BrowserSetUserAgentTool,
      BrowserSetGeolocationTool,
      BrowserSetTimezoneTool,
      BrowserAssertTextTool,
      BrowserAssertVisibleTool,
      BrowserAssertURLTool,
      ...(Flag.OPENCODE_EXPERIMENTAL_LSP_TOOL ? [LspTool] : []),
      ...(config.experimental?.batch_tool === true ? [BatchTool] : []),
      ...(Flag.OPENCODE_EXPERIMENTAL_PLAN_MODE && Flag.OPENCODE_CLIENT === "cli" ? [PlanExitTool, PlanEnterTool] : []),
      ...custom,
    ]
  }

  export async function ids() {
    return all().then((x) => x.map((t) => t.id))
  }

  export async function tools(providerID: string, agent?: Agent.Info) {
    const tools = await all()
    const result = await Promise.all(
      tools
        .filter((t) => {
          // Enable websearch/codesearch for zen users OR via enable flag
          if (t.id === "codesearch" || t.id === "websearch") {
            return providerID === "opencode" || Flag.OPENCODE_ENABLE_EXA
          }
          return true
        })
        .map(async (t) => {
          using _ = log.time(t.id)
          return {
            id: t.id,
            ...(await t.init({ agent })),
          }
        }),
    )
    return result
  }
}
