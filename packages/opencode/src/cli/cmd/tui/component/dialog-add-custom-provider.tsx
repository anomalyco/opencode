import { createSignal } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { Dialog } from "@tui/ui/dialog"
import { useTheme } from "@tui/context/theme"
import { useDialog } from "@tui/ui/dialog"
import { DialogPrompt } from "@tui/ui/dialog-prompt"
import { addCustomProvider, type CustomProviderConfig } from "@tui/util/custom-provider"

interface CustomProviderForm {
  id: string
  displayName: string
  baseURL: string
  apiKeyEnv: string
  modelId: string
  modelName: string
  contextLimit: number
  outputLimit: number
  capabilities: {
    temperature: boolean
    reasoning: boolean
    attachment: boolean
    toolCall: boolean
  }
}

export function DialogAddCustomProvider() {
  const { theme } = useTheme()
  const dialog = useDialog()
  const [step, setStep] = createSignal<0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8>(0)
  const [formData, setFormData] = createSignal<Partial<CustomProviderForm>>({})
  const [error, setError] = createSignal<string | undefined>()

  // Define the form structure
  const formSteps = [
    { field: "id" as keyof CustomProviderForm, title: "Provider ID", placeholder: "e.g., my-custom-provider" },
    {
      field: "displayName" as keyof CustomProviderForm,
      title: "Display Name",
      placeholder: "e.g., My Custom Provider",
    },
    {
      field: "baseURL" as keyof CustomProviderForm,
      title: "Base URL",
      placeholder: "e.g., https://api.myprovider.com/v1",
    },
    {
      field: "apiKeyEnv" as keyof CustomProviderForm,
      title: "API Key Environment Variable",
      placeholder: "e.g., MY_PROVIDER_API_KEY",
    },
    { field: "modelId" as keyof CustomProviderForm, title: "Model ID", placeholder: "e.g., my-model-v1" },
    { field: "modelName" as keyof CustomProviderForm, title: "Model Name", placeholder: "e.g., My Model V1" },
    { field: "contextLimit" as keyof CustomProviderForm, title: "Context Limit", placeholder: "e.g., 8192" },
    { field: "outputLimit" as keyof CustomProviderForm, title: "Output Limit", placeholder: "e.g., 4096" },
  ]

  // Handle form completion
  const handleComplete = async () => {
    try {
      // Validate required fields
      const requiredFields = ["id", "displayName", "baseURL", "apiKeyEnv", "modelId", "modelName"]
      for (const field of requiredFields) {
        if (!formData()[field as keyof CustomProviderForm]) {
          setError(`Field ${field} is required`)
          return
        }
      }

      // Set default limits if not provided
      const finalData: CustomProviderForm = {
        id: formData().id!,
        displayName: formData().displayName!,
        baseURL: formData().baseURL!,
        apiKeyEnv: formData().apiKeyEnv!,
        modelId: formData().modelId!,
        modelName: formData().modelName!,
        contextLimit: formData().contextLimit ?? 8192,
        outputLimit: formData().outputLimit ?? 4096,
        capabilities: {
          temperature: formData().capabilities?.temperature ?? true,
          reasoning: formData().capabilities?.reasoning ?? false,
          attachment: formData().capabilities?.attachment ?? false,
          toolCall: formData().capabilities?.toolCall ?? true,
        },
      }

      // Add the custom provider to configuration
      await addCustomProvider(finalData)

      // Show success message
      dialog.replace(
        () => (
          <Dialog title="Success" transition>
            <box paddingLeft={2} paddingRight={2} paddingBottom={1}>
              <text attributes={TextAttributes.BOLD} fg={theme.success}>
                Custom provider added successfully!
              </text>
              <text fg={theme.textMuted}>
                {"\n\n"}
                The provider '{finalData.displayName}' with model '{finalData.modelName}' has been added to your
                configuration.
                {"\n\n"}
                Remember to set your API key with:
                {"\n"}
                export {finalData.apiKeyEnv}="your-api-key"
              </text>
              <text fg={theme.text}>
                {"\n\n"}
                Press any key to continue...
              </text>
            </box>
          </Dialog>
        ),
        () => {
          dialog.clear()
        },
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error occurred")
      setStep(0)
    }
  }

  // Handle step navigation
  const handleStepInput = async (value: string) => {
    const currentField = formSteps[step()].field

    if (currentField === "contextLimit" || currentField === "outputLimit") {
      const numValue = parseInt(value)
      if (isNaN(numValue) || numValue <= 0) {
        setError("Please enter a valid positive number")
        return
      }
      setFormData((prev) => ({ ...prev, [currentField]: numValue }))
    } else {
      setFormData((prev) => ({ ...prev, [currentField]: value }))
    }

    if (step() < formSteps.length - 1) {
      setStep((prev) => (prev + 1) as typeof step extends () => infer T ? T : never)
      setError(undefined)
    } else {
      // Move to the last step which handles capabilities
      setStep(8)
    }
  }

  // Handle capabilities step - in this case, we'll just go straight to completion
  const handleCapabilities = () => {
    setStep(8) // Go to completion step
  }

  // Render current step
  const renderStep = () => {
    const currentStep = step()

    if (currentStep < formSteps.length) {
      const current = formSteps[currentStep]
      return (
        <DialogPrompt
          title={`[${currentStep + 1}/${formSteps.length}] ${current.title}`}
          placeholder={current.placeholder}
          onConfirm={handleStepInput}
          onCancel={() => {
            if (currentStep > 0) {
              setStep((prev) => (prev - 1) as typeof step extends () => infer T ? T : never)
              setError(undefined)
            } else {
              dialog.clear()
            }
          }}
          error={error()}
        />
      )
    }

    if (currentStep === 8) {
      return (
        <Dialog title="Ready to Add" transition>
          <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
            <text fg={theme.text}>Ready to add your custom provider to the configuration?</text>

            <text fg={theme.textMuted}>
              {"\n"}
              Provider ID: {formData().id}
            </text>
            <text fg={theme.textMuted}>Display Name: {formData().displayName}</text>
            <text fg={theme.textMuted}>Base URL: {formData().baseURL}</text>
            <text fg={theme.textMuted}>API Key Env: {formData().apiKeyEnv}</text>
            <text fg={theme.textMuted}>Model ID: {formData().modelId}</text>
            <text fg={theme.textMuted}>Model Name: {formData().modelName}</text>

            <text fg={theme.text}>
              {"\n\n"}
              Press Enter to confirm or Esc to cancel
            </text>
          </box>
        </Dialog>
      )
    }
  }

  return renderStep()
}
