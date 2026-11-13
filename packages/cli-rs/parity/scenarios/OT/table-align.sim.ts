// OT2112 (parity/deviations/OT2112-table-alignment.md): a reply with a packing list whose `Qty` column is
// right-aligned (`---:`) and whose `Weight` and `Packed` columns are centred (`:---:`). TS left-aligns every column;
// Rust aligns them as the delimiter row says. The characters of the left-aligned `Item` column and the borders are
// equal.
import { defineSim } from "../../sim/scenario"

const duration = { line: "· \\d.*", reason: "the turn duration depends on timing, also in length; the row ends there" }

const reply = [
  "Packing list:",
  "",
  "| Item | Qty | Weight | Packed |",
  "| :--- | ---: | :---: | :---: |",
  "| Tent | 1 | 2.4 kg | yes |",
  "| Sleeping bag | 2 | 1.1 kg | no |",
  "| Headlamp | 12 | 90 g | yes |",
  "",
  "Done.",
].join("\n")

export default defineSim({
  model: [{ items: [{ type: "textDelta", text: reply }] }],
  steps: [
    { until: "Simulated Model" },
    { type: "Pack" },
    { until: "Pack" },
    { enter: true },
    {
      checkpoint: "done",
      until: "Done.",
      masks: [duration],
      deviation: [{ file: "OT2112-table-alignment", cells: 86 }],
    },
  ],
})
