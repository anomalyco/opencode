import { getComponentCatalogue } from "@opentui/solid/components"
import { registerSpinner } from "opentui-spinner/solid"

export function registerArgusSpinner() {
  if (!getComponentCatalogue().spinner) registerSpinner()
}
