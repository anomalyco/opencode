import { Plugin } from "./index"

export const ExamplePlugin: Plugin = async ({
  client: _client,
  $: _shell,
  project: _project,
  directory: _directory,
  worktree: _worktree,
}) => {
  return {
    permission: {},
    async "chat.params"(_input, output) {
      output.topP = 1
    },
  }
}
