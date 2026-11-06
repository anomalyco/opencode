import { Analysis, Kerning, Performance } from "./analysis"
import { Construction, Timeline } from "./construction"
import { Anagrams, Colophon, Cover, Poster, Tester, Waterfall } from "./display"
import { Field } from "./field"
import { Loupe } from "./loupe"
import { Exploded } from "./exploded"
import { Passports } from "./passports"
import { Universe } from "./universe"

/** Everything below the hero: a type specimen in sixteen plates, in its own layout system. */
export function Specimen() {
  return (
    <div data-component="specimen">
      <Cover />
      <Construction />
      <Timeline />
      <Exploded />
      <Passports />
      <Analysis />
      <Kerning />
      <Performance />
      <Poster />
      <Waterfall />
      <Anagrams />
      <Field />
      <Loupe />
      <Tester />
      <Universe />
      <Colophon />
    </div>
  )
}
