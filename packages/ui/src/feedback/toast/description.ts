// A toast shows a few lines; the rest of a long description would only be retained (in the dedupe
// key, the active-toast registry and the toaster's store) for as long as the toast lives. Server
// errors have carried a whole data URL here.
export const toastDescriptionLimit = 2000

export function boundToastDescription<T extends { description?: string }>(options: T): T {
  if (!options.description || options.description.length <= toastDescriptionLimit) return options
  return { ...options, description: `${options.description.slice(0, toastDescriptionLimit)}…` }
}
