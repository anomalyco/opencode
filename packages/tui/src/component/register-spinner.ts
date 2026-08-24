import { getComponentCatalogue } from "@opentui/solid/components"
import { registerSpinner } from "opentui-spinner/solid"

export function registerPencodeSpinner() {
  if (!getComponentCatalogue().spinner) registerSpinner()
}
