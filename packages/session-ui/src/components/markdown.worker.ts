/// <reference lib="webworker" />

import { ShikiStreamTokenizer } from "@shikijs/stream"
import { createMarkdownParser } from "@opencode-ai/ui/context/marked-parser"
import { OpenCodeTheme } from "@opencode-ai/ui/context/marked-theme"
import {
  bundledLanguages,
  createHighlighter,
  getTokenStyleObject,
  stringifyTokenStyle,
  type BundledLanguage,
  type ThemedToken,
} from "shiki"
import type { MarkdownToken, MarkdownWorkerRequest, MarkdownWorkerResponse } from "./markdown-worker-protocol"
import { createLatestWorkerQueue } from "./markdown-worker-queue"
import { project, type Projection } from "./markdown-stream"

type Stream = {
  language: string
  source: string
  tokenizer: ShikiStreamTokenizer
}

const streams = new Map<string, Stream>()
const projections = new Map<string, Projection>()
let highlighter: ReturnType<typeof createHighlighter> | undefined
const highlightQueue = createLatestWorkerQueue<Extract<MarkdownWorkerRequest, { type: "highlight" }>>({
  run: highlight,
  supersede: (request) => post({ type: "superseded", id: request.id, key: request.key }),
  dispose: (key) => void streams.delete(key),
})
const projectQueue = createLatestWorkerQueue<Extract<MarkdownWorkerRequest, { type: "project" }>>({
  run: runProject,
  supersede: (request) => post({ type: "superseded", id: request.id, key: request.key }),
  dispose: (key) => void projections.delete(key),
})
const parser = createMarkdownParser(async (code, language) => {
  const instance = await getHighlighter()
  const name = language in bundledLanguages ? language : "text"
  if (!instance.getLoadedLanguages().includes(name))
    await instance.loadLanguage(bundledLanguages[name as BundledLanguage])
  return instance
    .codeToHtml(code, { lang: name as BundledLanguage, theme: "OpenCode", tabindex: false })
    .replace("<code>", `<code class="language-${name}">`)
})

self.onmessage = (event: MessageEvent<MarkdownWorkerRequest>) => {
  if (event.data.type === "dispose") {
    highlightQueue.dispose(event.data.key)
    projectQueue.dispose(event.data.key)
    return
  }
  if (event.data.type === "parse") {
    void parse(event.data)
    return
  }
  if (event.data.type === "project") {
    projectQueue.highlight(event.data)
    return
  }

  highlightQueue.highlight(event.data)
}

async function parse(request: Extract<MarkdownWorkerRequest, { type: "parse" }>) {
  try {
    post({ type: "parse", id: request.id, html: await parser.parse(request.text) })
  } catch (error) {
    post({ type: "error", id: request.id, message: error instanceof Error ? error.message : String(error) })
  }
}

async function runProject(request: Extract<MarkdownWorkerRequest, { type: "project" }>) {
  try {
    const projection = project(projections.get(request.key), request.text, request.live)
    projections.set(request.key, projection)
    post({ type: "project", id: request.id, key: request.key, projection })
  } catch (error) {
    post({
      type: "error",
      id: request.id,
      key: request.key,
      message: error instanceof Error ? error.message : String(error),
    })
  }
}

async function highlight(request: Extract<MarkdownWorkerRequest, { type: "highlight" }>) {
  try {
    const instance = await getHighlighter()
    const language = request.language in bundledLanguages ? request.language : "text"
    if (!instance.getLoadedLanguages().includes(language))
      await instance.loadLanguage(bundledLanguages[language as BundledLanguage])

    if (request.complete) {
      const result = instance.codeToTokens(request.text, { lang: language as BundledLanguage, theme: "OpenCode" })
      streams.delete(request.key)
      post({
        type: "highlight",
        id: request.id,
        key: request.key,
        language,
        reset: true,
        stable: result.tokens
          .flatMap((line, index) =>
            index === result.tokens.length - 1 ? line : [...line, { content: "\n", offset: 0 }],
          )
          .map(token),
        unstable: [],
      })
      return
    }

    const previous = streams.get(request.key)
    const reset = !previous || previous.language !== language || !request.text.startsWith(previous.source)
    const stream = reset
      ? {
          language,
          source: "",
          tokenizer: new ShikiStreamTokenizer({ highlighter: instance, lang: language, theme: "OpenCode" }),
        }
      : previous
    const result = await stream.tokenizer.enqueue(request.text.slice(stream.source.length))
    stream.source = request.text
    streams.set(request.key, stream)
    post({
      type: "highlight",
      id: request.id,
      key: request.key,
      language,
      reset,
      stable: result.stable.filter((token) => token.content.length > 0).map(token),
      unstable: result.unstable.filter((token) => token.content.length > 0).map(token),
    })
  } catch (error) {
    post({
      type: "error",
      id: request.id,
      key: request.key,
      message: error instanceof Error ? error.message : String(error),
    })
  }
}

function getHighlighter() {
  return (highlighter ??= createHighlighter({ themes: [OpenCodeTheme], langs: [] }))
}

function post(response: MarkdownWorkerResponse) {
  self.postMessage(response)
}

function token(value: ThemedToken): MarkdownToken {
  return [value.content, stringifyTokenStyle(value.htmlStyle ?? getTokenStyleObject(value))]
}
