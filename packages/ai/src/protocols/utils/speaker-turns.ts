/** Split an ordered token list into runs of consecutive tokens with the same speaker. */
export const group = <Item>(items: ReadonlyArray<Item>, speaker: (item: Item) => unknown) =>
  items.reduce<Array<Array<Item>>>((turns, item) => {
    const last = turns.at(-1)
    if (last === undefined || speaker(last[0]) !== speaker(item)) return [...turns, [item]]
    last.push(item)
    return turns
  }, [])

export * as SpeakerTurns from "./speaker-turns.js"
