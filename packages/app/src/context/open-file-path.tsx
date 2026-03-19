import { createSimpleContext } from "@opencode-ai/ui/context"
import { usePlatform } from "@/context/platform"
import { openFilePath, type OpenFileInput } from "@/utils/open-file-path"

export const { use: useOpenFilePath, provider: OpenFilePathProvider } = createSimpleContext({
  name: "OpenFilePath",
  init: (props: { directory: string }) => {
    const platform = usePlatform()

    return {
      open(input: OpenFileInput) {
        return openFilePath({
          directory: props.directory,
          input,
          platform,
        })
      },
    }
  },
})
