import { ModalModels } from "../../modal/models.js"
import { createRemoteModelsPlugin } from "./remote-models.js"

export const ModalPlugin = createRemoteModelsPlugin({
  id: "opencode.provider.modal",
  providerID: "modal",
  env: "MODAL_PROXY_TOKEN",
  label: "Modal",
  load: ModalModels.load,
  derive: ModalModels.derive,
})
