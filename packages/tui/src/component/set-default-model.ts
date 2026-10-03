import type { useSDK } from "../context/sdk"
import type { useToast } from "../ui/toast"
import { errorMessage } from "../util/error"

export async function setDefaultModel(input: {
  sdk: ReturnType<typeof useSDK>
  toast: ReturnType<typeof useToast>
  model: { providerID: string; modelID: string }
}) {
  const id = `${input.model.providerID}/${input.model.modelID}`
  const result = await input.sdk.client.global.config.update({ config: { model: id } })
  if (result.error) {
    input.toast.show({
      variant: "error",
      title: "Failed to set default model",
      message: errorMessage(result.error),
    })
    return
  }
  input.toast.show({
    variant: "success",
    message: `Default model set to ${id}`,
  })
}
