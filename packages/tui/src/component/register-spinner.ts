import { getComponentCatalogue } from "@opentui/solid/components"
import { registerSpinner } from "opentui-spinner/solid"

export function registerOpencodeSpinner() {
  if (!getComponentCatalogue().spinner) registerSpinner()
}
