import { Markdown } from "../components/markdown"
import { LinkPreviews } from "./link-previews"

export default {
  title: "OpenCode/Conversation/Link previews",
  id: "link-previews",
  component: LinkPreviews,
  parameters: {
    docs: {
      description: {
        component:
          "A finished reply's links as compact rows under it. GitHub repositories, issues, pull requests and commits load their title and state from GitHub's public API on this device; other pages read their path and site.",
      },
    },
  },
}

const mixed = [
  "The retry policy lives in [anomalyco/opencode](https://github.com/anomalyco/opencode). The ordering fix is",
  "https://github.com/anomalyco/opencode/pull/59555, which follows",
  "[#59529](https://github.com/anomalyco/opencode/pull/59529).",
  "",
  "- The bug report: https://github.com/anomalyco/opencode/issues/59561",
  "- The release commit: https://github.com/anomalyco/opencode/commit/86976449c40d48f2731553a024f74552593d1764",
  "- Background: [Agents](https://opencode.ai/docs/agents/)",
].join("\n")

const pair = [
  "[#59558](https://github.com/anomalyco/opencode/pull/59558) shipped the release; its commit is",
  "https://github.com/anomalyco/opencode/commit/86976449c40d48f2731553a024f74552593d1764.",
].join("\n")

function Reply(props: { text: string }) {
  return (
    <div class="mx-auto max-w-[720px] bg-background-base px-5 py-4" data-component="text-part">
      <div data-slot="text-part-body">
        <Markdown text={props.text} />
      </div>
      <LinkPreviews text={props.text} />
    </div>
  )
}

export const MixedLinks = {
  render: () => <Reply text={mixed} />,
}

export const TwoLinks = {
  render: () => <Reply text={pair} />,
}
