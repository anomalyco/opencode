import { createSignal, For, type JSX, Match, onCleanup, Show, Switch } from "solid-js"
import { config } from "~/config"
import { NewTab } from "./icons"
import "./markdown-view.css"

type Block =
  | { kind: "heading"; level: number; marker: string; text: string }
  | { kind: "code"; open: string; code: string; close: string }
  | { kind: "item"; marker: string; text: string }
  | { kind: "rule"; text: string }
  | { kind: "blank" }
  | { kind: "text"; text: string }

/**
 * The page's Markdown source shown as a document: every marker stays visible (`#`, `-`, `**`,
 * fences), and links keep their `[text](url)` form but still work.
 */
export function MarkdownView(props: { source: string; file: string; href?: string; home: string; onHome: () => void }) {
  const [copied, setCopied] = createSignal(false)
  let timer: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => clearTimeout(timer))

  const copy = () => {
    void navigator.clipboard.writeText(props.source).then(() => {
      setCopied(true)
      clearTimeout(timer)
      timer = setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <article data-component="markdown-view" aria-label="This page as Markdown">
      <header data-slot="bar">
        <nav data-slot="crumbs" aria-label="Breadcrumb">
          <a href={props.home} onClick={() => props.onHome()}>
            Home
          </a>
          <span aria-hidden="true">|</span>
          <Show
            when={props.href}
            fallback={
              <span data-slot="file" aria-current="page">
                {props.file}
              </span>
            }
          >
            {(href) => (
              <a href={href()} target="_blank" data-slot="file" aria-current="page">
                {props.file}
                <NewTab />
              </a>
            )}
          </Show>
        </nav>
        <div data-slot="actions">
          <button type="button" data-slot="copy" data-funnel-copy="page-markdown" onClick={copy}>
            <span aria-live="polite">{copied() ? "Copied" : "Copy Markdown"}</span>
          </button>
        </div>
      </header>
      <div data-slot="doc">
        <For each={parse(props.source)}>
          {(block) => (
            <Switch>
              <Match when={block.kind === "heading" && block}>
                {(heading) => (
                  <Heading level={heading().level}>
                    <span data-slot="marker">{heading().marker} </span>
                    <Inline text={heading().text} />
                  </Heading>
                )}
              </Match>
              <Match when={block.kind === "code" && block}>
                {(code) => (
                  <pre data-slot="code">
                    <span data-slot="marker">{code().open}</span>
                    {"\n"}
                    <code>{code().code}</code>
                    {"\n"}
                    <span data-slot="marker">{code().close}</span>
                  </pre>
                )}
              </Match>
              <Match when={block.kind === "item" && block}>
                {(item) => (
                  <p data-slot="item">
                    <span data-slot="marker">{item().marker} </span>
                    <Inline text={item().text} />
                  </p>
                )}
              </Match>
              <Match when={block.kind === "rule" && block}>
                {(rule) => (
                  <p data-slot="rule" role="separator">
                    <span data-slot="marker">{rule().text}</span>
                  </p>
                )}
              </Match>
              <Match when={block.kind === "blank"}>
                <p data-slot="blank" aria-hidden="true" />
              </Match>
              <Match when={block.kind === "text" && block}>
                {(text) => (
                  <p>
                    <Inline text={text().text} />
                  </p>
                )}
              </Match>
            </Switch>
          )}
        </For>
      </div>
    </article>
  )
}

function Heading(props: { level: number; children: JSX.Element }) {
  return (
    <Switch fallback={<h3 data-slot="heading">{props.children}</h3>}>
      <Match when={props.level === 1}>
        <h1 data-slot="heading">{props.children}</h1>
      </Match>
      <Match when={props.level === 2}>
        <h2 data-slot="heading">{props.children}</h2>
      </Match>
    </Switch>
  )
}

/** Links, bold and inline code, with their Markdown markers kept in the text. */
function Inline(props: { text: string }) {
  const parts = () =>
    [...props.text.matchAll(/\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*|`([^`]+)`|[^[*`]+|[[*`]/g)].map((match) => {
      if (match[1] !== undefined) return { kind: "link" as const, text: match[1], url: match[2] }
      if (match[3] !== undefined) return { kind: "bold" as const, text: match[3] }
      if (match[4] !== undefined) return { kind: "code" as const, text: match[4] }
      return { kind: "text" as const, text: match[0] }
    })

  return (
    <For each={parts()}>
      {(part) => (
        <Switch fallback={part.text}>
          <Match when={part.kind === "link" && part}>
            {(link) => {
              // Site links open on this site, wherever it runs.
              const local = link().url.startsWith(`${config.baseUrl}/`)
              return (
                <a
                  href={local ? link().url.slice(config.baseUrl.length) : link().url}
                  target={local ? undefined : "_blank"}
                  data-slot="link"
                >
                  <span data-slot="marker">[</span>
                  <span data-slot="label">{link().text}</span>
                  <span data-slot="marker">]({link().url})</span>
                </a>
              )
            }}
          </Match>
          <Match when={part.kind === "bold"}>
            <strong>
              <span data-slot="marker">**</span>
              {part.text}
              <span data-slot="marker">**</span>
            </strong>
          </Match>
          <Match when={part.kind === "code"}>
            <code>
              <span data-slot="marker">`</span>
              {part.text}
              <span data-slot="marker">`</span>
            </code>
          </Match>
        </Switch>
      )}
    </For>
  )
}

function parse(source: string) {
  const lines = source.replace(/\n$/, "").split("\n")
  const blocks: Block[] = []
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]
    if (line.startsWith("```")) {
      const end = lines.findIndex((item, position) => position > index && item.startsWith("```"))
      const close = end === -1 ? lines.length : end
      blocks.push({ kind: "code", open: line, code: lines.slice(index + 1, close).join("\n"), close: "```" })
      index = close
      continue
    }
    blocks.push(parseLine(line))
  }
  return blocks
}

function parseLine(line: string): Block {
  const heading = /^(#{1,6}) (.*)$/.exec(line)
  if (heading) return { kind: "heading", level: heading[1].length, marker: heading[1], text: heading[2] }
  const item = /^(\s*(?:[-*]|\d+\.)) (.*)$/.exec(line)
  if (item) return { kind: "item", marker: item[1], text: item[2] }
  if (/^(-{3,}|\*{3,})$/.test(line)) return { kind: "rule", text: line }
  if (!line.trim()) return { kind: "blank" }
  return { kind: "text", text: line }
}
