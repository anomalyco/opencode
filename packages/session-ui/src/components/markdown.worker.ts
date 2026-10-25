/// <reference lib="webworker" />

import { ShikiStreamTokenizer } from "@shikijs/stream"
import { createMarkdownParser } from "@bolt-ai/ui/context/marked-parser"
import { BoltTheme } from "@bolt-ai/ui/context/marked-theme"
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
  tokenizer: LiveTokenizer
}

const streams = new Map<string, Stream>()

const projections = new Map<string, Projection>()

const parser = createMarkdownParser()

const highlightQueue = createLatestWorkerQueue<Extract<MarkdownWorkerRequest, { type: "highlight" }>>({
  run: highlight,
  supersede: (request) => post({ type: "superseded", id: request.id, key: request.key }),
  dispose: closeStream,
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
  return instance.codeToHtml(code, { lang: name as BundledLanguage, theme: "Bolt", tabindex: false })
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
    // Report the requested language so the viewer can label the block and spot Mermaid; lex unknown ones as text.
    const language = request.language
    const lang = isSupportedLanguage(language) ? language : "text"

    if (request.complete) {
      const result = instance.codeToTokens(request.text, { lang: language as BundledLanguage, theme: "Bolt" })
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
          tokenizer: new ShikiStreamTokenizer({ highlighter: instance, lang: language, theme: "Bolt" }),
        }
      : previous
    const result = await stream.tokenizer.enqueue(request.text.slice(stream.source.length))
    stream.source = request.text
    streams.set(request.key, stream)

    const last = stream.tokenizer.lineCount - 1

    post({
      type: "highlight",
      id: request.id,
      key: request.key,
      language,
      reset,
      stable: Array.from({ length: last - start }, (_, index) => [
        ...stream.tokenizer.getLineTokens(start + index).tokens,
        { content: "\n", offset: 0 },
      ])
        .flat()
        .filter((token) => token.content.length > 0)
        .map(token),
      unstable: stream.tokenizer
        .getLineTokens(last)
        .tokens.filter((token) => token.content.length > 0)
        .map(token),
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
  return (highlighter ??= createHighlighter({ themes: [BoltTheme], langs: [] }))
}

function post(response: MarkdownWorkerResponse) {
  self.postMessage(response)
}

function token(value: ThemedToken): MarkdownToken {
  const fontStyle = value.fontStyle ?? 0

  return [
    value.content,
    [
      value.color && `color:${value.color}`,
      fontStyle & 1 && "font-style:italic",
      fontStyle & 2 && "font-weight:bold",
    ]
      .filter(Boolean)
      .join(";"),
  ]
}
