import { GmiCloudModels } from "../../gmicloud/models.js"
import { createRemoteModelsPlugin } from "./remote-models.js"

export const GmiCloudPlugin = createRemoteModelsPlugin({
  id: "opencode.provider.gmicloud",
  providerID: "gmicloud",
  env: "GMICLOUD_API_KEY",
  label: "GMI Cloud",
  defaultBaseURL: "https://api.gmi-serving.com/v1",
  load: GmiCloudModels.load,
  derive: GmiCloudModels.derive,
})
