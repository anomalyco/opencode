import type { Component } from "solid-js"
import { Analysis, Kerning, Performance } from "~/component/font/analysis"
import { Construction, Timeline } from "~/component/font/construction"
import { Anagrams, Colophon, Cover, Tester } from "~/component/font/display"
import { Exploded } from "~/component/font/exploded"
import { Field } from "~/component/font/field"
import { Loupe } from "~/component/font/loupe"
import { Typewriter } from "~/component/font/typewriter"
import { Universe } from "~/component/font/universe"
import { FilmPlate } from "~/component/font-film/section"
import { swap } from "../solid"

// The parts of the font page (routes/font) that move or answer the reader: the hero's typewriter, and
// the plates, by id (Exploded's by the scroll track around it). The other plates (Passports, Poster,
// Waterfall) are still pictures and stay as the server rendered them.
const views: Record<string, Component> = {
  "font-hero": Typewriter,
  film: FilmPlate,
  cover: Cover,
  construction: Construction,
  timeline: Timeline,
  "exploded-scroll": Exploded,
  analysis: Analysis,
  kerning: Kerning,
  performance: Performance,
  anagrams: Anagrams,
  field: Field,
  loupe: Loupe,
  tester: Tester,
  universe: Universe,
  colophon: Colophon,
}

/** Renders one of them again in the browser, in place of the server's copy, in the same task. */
export default function font(root: HTMLElement) {
  const View = views[root.dataset.plate ?? root.dataset.slot ?? root.dataset.component ?? ""]
  if (View) void swap(() => <View />, root)
}
