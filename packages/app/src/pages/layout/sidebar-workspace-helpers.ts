export const workspaceOpenState = (expanded: Record<string, boolean>, directory: string, local: boolean) =>
  expanded[directory] ?? local
