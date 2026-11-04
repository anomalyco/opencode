import type { Block } from "./markdown-stream"

export type MarkdownToken = [content: string, style: string]

export type MarkdownWorkerRequest =
  | { type: "parse"; id: number; text: string }
  | { type: "project"; id: number; key: string; text: string; live: boolean }
  | { type: "highlight"; id: number; key: string; text: string; language: string; complete?: boolean }
  | { type: "dispose"; key: string }

export type MarkdownWorkerResponse =
  | { type: "parse"; id: number; html: string }
  | { type: "project"; id: number; key: string; from: number; blocks: Block[] }
  | {
      type: "highlight"
      id: number
      key: string
      language: string
      reset: boolean
      stable: MarkdownToken[]
      unstable: MarkdownToken[]
    }
  | { type: "error"; id: number; key?: string; message: string }
  | { type: "superseded"; id: number; key: string }

export type MarkdownWorkerState = {
  id: number
  generation: number
  language: string
  stable: MarkdownToken[]
  unstable: MarkdownToken[]
}

export function shouldReleaseMarkdownWorkerState(complete: boolean, latestID: number | undefined, responseID: number) {
  return complete && latestID === responseID
}

// A streamed answer keeps its settled blocks, so each projection response carries only the blocks from the first one
// that changed since the previous response for its key. Resending them all copied the whole answer on every delta.
export function diffProjectionBlocks(previous: Block[] | undefined, next: Block[]) {
  const same = previous ? next.findIndex((block, index) => block !== previous[index]) : 0
  const from = same === -1 ? next.length : same

  return { from, blocks: next.slice(from) }
}

export function applyProjectionBlocks(previous: Block[] | undefined, from: number, blocks: Block[]) {
  return [...(previous ?? []).slice(0, from), ...blocks]
}

export function markdownBlockKey(owner: string, cacheKey: string | undefined, index: number, mode: string) {
  return `${owner}:${cacheKey ? `${cacheKey}:${index}:${mode}` : `block:${index}`}`
}

export function applyMarkdownWorkerResponse(
  state: MarkdownWorkerState | undefined,
  response: Extract<MarkdownWorkerResponse, { type: "highlight" }>,
) {
  if (state && response.id <= state.id) return state

  return {
    id: response.id,
    generation: (state?.generation ?? 0) + (response.reset ? 1 : 0),
    language: response.language,
    stable: response.reset ? response.stable : [...(state?.stable ?? []), ...response.stable],
    unstable: response.unstable,
  }
}
