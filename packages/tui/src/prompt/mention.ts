import type { PromptInput, PromptMention } from "@opencode-ai/schema"
import type { EditablePromptInput } from "./codec"
import { promptOffsetWidth } from "./display"
import { expandTrackedPastedText } from "./part"

type TextRange = {
  start: number
  end: number
}

type MentionItem = {
  index: number
  mention: PromptMention
}

type CandidateRange = TextRange & {
  offset: number
}

export function realignPromptMentions(
  content: string,
  mentions: readonly (PromptMention | undefined)[],
): Array<PromptMention | undefined> {
  const protectedRanges: TextRange[] = []
  const aligned = mentions.map((mention) => (mention && !mention.text ? { ...mention } : undefined))
  const groups = mentions.reduce((result, mention, index) => {
    if (!mention?.text) return result
    const group = result.get(mention.text) ?? []
    group.push({ mention, index })
    result.set(mention.text, group)
    return result
  }, new Map<string, MentionItem[]>())

  for (const [text, items] of [...groups.entries()].sort(
    ([left], [right]) => right.length - left.length || left.localeCompare(right),
  )) {
    const candidates = mentionRanges(content, text)
    const available = candidates.filter(
      (candidate) => !protectedRanges.some((range) => overlaps(candidate, range)),
    )
    for (const [item, candidate] of assignMentions(items, available)) {
      aligned[item.index] = {
        text,
        start: candidate.offset,
        end: candidate.offset + promptOffsetWidth(text),
      }
    }
    protectedRanges.push(...candidates)
  }

  return aligned
}

export function realignPromptInputMentions(content: string, input: PromptInput.Prompt): EditablePromptInput {
  const files = input.files ?? []
  const agents = input.agents ?? []
  const mentions = realignPromptMentions(content, [
    ...files.map((file) => file.mention),
    ...agents.map((agent) => agent.mention),
  ])
  const align = <T extends { mention?: PromptMention }>(items: readonly T[] | undefined, offset = 0) =>
    items?.flatMap((item, index) => {
      if (!item.mention?.text) return [{ ...item, mention: item.mention ? { ...item.mention } : undefined }]
      const mention = mentions[offset + index]
      return mention ? [{ ...item, mention }] : []
    })

  return {
    text: content,
    files: align(input.files),
    agents: align(input.agents, files.length),
  }
}

export function expandPromptInputPastedText(
  input: PromptInput.Prompt,
  pasted: readonly { text: string; source: { start: number; end: number } }[],
): EditablePromptInput {
  const ranges = pasted.map((part) => ({ ...part.source, text: part.text }))
  const shift = (mention: PromptMention | undefined) => {
    if (!mention) return
    const offset = ranges.reduce(
      (total, range) =>
        range.end <= mention.start ? total + promptOffsetWidth(range.text) - (range.end - range.start) : total,
      0,
    )
    return { ...mention, start: mention.start + offset, end: mention.end + offset }
  }

  return {
    text: expandTrackedPastedText(input.text, ranges),
    files: input.files?.map((file) => ({ ...file, mention: shift(file.mention) })),
    agents: input.agents?.map((agent) => ({ ...agent, mention: shift(agent.mention) })),
  }
}

function mentionRanges(content: string, text: string): CandidateRange[] {
  const ranges: CandidateRange[] = []
  let searchFrom = 0
  while (true) {
    const start = content.indexOf(text, searchFrom)
    if (start === -1) return ranges
    ranges.push({ start, end: start + text.length, offset: promptOffsetWidth(content.slice(0, start)) })
    searchFrom = start + text.length
  }
}

function assignMentions(items: MentionItem[], candidates: CandidateRange[]) {
  const ordered = items.toSorted((left, right) => left.mention.start - right.mention.start || left.index - right.index)
  const memo = new Map<string, { matches: number; cost: number; pairs: Array<[MentionItem, CandidateRange]> }>()

  function solve(item: number, candidate: number): { matches: number; cost: number; pairs: Array<[MentionItem, CandidateRange]> } {
    if (item >= ordered.length || candidate >= candidates.length) return { matches: 0, cost: 0, pairs: [] }
    const key = `${item}:${candidate}`
    const cached = memo.get(key)
    if (cached) return cached

    const tail = solve(item + 1, candidate + 1)
    const current = ordered[item]!
    const range = candidates[candidate]!
    const matched = {
      matches: tail.matches + 1,
      cost: tail.cost + Math.abs(range.offset - current.mention.start),
      pairs: [[current, range] as [MentionItem, CandidateRange], ...tail.pairs],
    }
    const result = [matched, solve(item + 1, candidate), solve(item, candidate + 1)].reduce((best, next) => {
      if (next.matches !== best.matches) return next.matches > best.matches ? next : best
      return next.cost < best.cost ? next : best
    })
    memo.set(key, result)
    return result
  }

  return solve(0, 0).pairs
}

function overlaps(left: TextRange, right: TextRange) {
  return left.start < right.end && left.end > right.start
}
