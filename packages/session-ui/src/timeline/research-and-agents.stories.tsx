import { CurrentSessionTimelineStory } from "../storybook/current-session-story"
import {
  inspectAndExplainDocument,
  loadedResourcesDocument,
  subagentDocument,
  webResearchDocument,
} from "../storybook/current-session-fixtures"
import { SessionTimeline } from "./session-timeline"

export default {
  title: "OpenCode/Work/Research and agents",
  id: "current-session-research-agents",
  component: SessionTimeline,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Read-only investigation and delegated work using the production context group, web tools, skill notice, and child-Session cards.",
      },
    },
  },
}

export const InspectTheCodebase = {
  render: () => (
    <CurrentSessionTimelineStory
      title="Inspect the codebase"
      description="Glob, grep, and read calls collapse into one context group before the explanation."
      document={inspectAndExplainDocument}
      width="760px"
    />
  ),
}

export const ResearchTheWeb = {
  render: () => (
    <CurrentSessionTimelineStory
      title="Research the web"
      description="A targeted search and source fetch precede a short answer with no code changes."
      document={webResearchDocument}
      width="760px"
    />
  ),
}

export const LoadedResources = {
  render: () => (
    <CurrentSessionTimelineStory
      title="Loaded instruction file and skill"
      description="The assistant reads project instructions, loads specialized guidance, and applies both to its response."
      document={loadedResourcesDocument}
      width="760px"
    />
  ),
}

export const DelegateFocusedTasks = {
  render: () => (
    <CurrentSessionTimelineStory
      title="Delegate focused tasks"
      description="A completed review and an active test task show the two normal child-Session states together."
      document={subagentDocument}
      width="760px"
    />
  ),
}
