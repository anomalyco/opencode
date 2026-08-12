# Releasing opencode-drive

`opencode-drive` keeps its own version line. OpenCode product releases must not rewrite its version.

The imported baseline is `1.4.3` and the workspace package remains `private` until release setup is complete.
Do not remove that guard or publish from this repository until both release gates are complete:

1. The versions of `@opencode-ai/client` and `@opencode-ai/protocol` written into the packed Drive manifest are available on npm, including the `@opencode-ai/protocol/simulation` export.
2. npm package administration and trusted publishing move from `anomalyco/opencode-drive` to `anomalyco/opencode`.

The npm package is currently maintained by `jlongster`, and its trusted publisher is the old repository's
`publish.yml`. James must add the destination release operator as an npm owner or update the trusted publisher
himself. Keep James as an owner through the first successful release from this repository.

The first destination release will be `1.4.4`, which contains the pending special-key fix after `1.4.3`. Use a
dedicated GitHub-hosted workflow named `publish-drive.yml` with Node 24, npm trusted publishing, and
`id-token: write`. Its tag must be `opencode-drive-v1.4.4`; bare `v1.4.4` already belongs to OpenCode.

Before enabling that workflow:

1. Pack Drive and inspect the rewritten `package.json` inside the tarball.
2. Install the tarball in a clean Bun consumer and import every public export.
3. Run the installed `opencode-drive` binary and one scripted flow.
4. Configure npm's trusted publisher for `anomalyco/opencode` and `publish-drive.yml`.
5. Publish the namespaced tag and verify npm provenance points at this repository and workflow.

After the first successful destination release, disable the old publish workflow and archive the old repository.
