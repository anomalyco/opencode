/**
 * @deprecated Use VCS Manager with GitLab provider instead
 *
 * This module has been refactored. All exports are now re-exported from
 * packages/opencode/src/vcs/github/github.ts for backward compatibility.
 *
 * Please migrate to the GitLab provider using the VCS Manager.
 */

// Re-export for backward compatibility
export {
  parseGitHubRemote,
  extractResponseText,
  formatPromptTooLargeError,
  GithubCommand,
  GithubInstallCommand,
  GithubRunCommand,
  GitHubProvider,
  type GitHubConfig,
} from "../../vcs/github/github"
