import { CurrentSessionTimelineStory } from "../storybook/current-session-story"
import {
  executeCodeDocument,
  expandedShellDocument,
  recoveryDocument,
  standaloneShellCompletedDocument,
  standaloneShellRunningDocument,
  terminalFailedDocument,
  terminalPassedDocument,
  terminalRunningDocument,
} from "../storybook/current-session-fixtures"
import { SessionTimeline } from "./session-timeline"

export default {
  title: "OpenCode/Work/Terminal",
  id: "current-session-terminal-work",
  component: SessionTimeline,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Common shell states in a real Session turn: an active command, a successful check, a focused failure, and the follow-up correction.",
      },
    },
  },
}

export const RunningTests = {
  render: () => (
    <CurrentSessionTimelineStory
      title="Running tests"
      description="The active shell message keeps its progress treatment and can be opened while running."
      document={terminalRunningDocument}
      width="720px"
      shellToolDefaultOpen
    />
  ),
}

export const RunningAUserCommand = {
  render: () => (
    <CurrentSessionTimelineStory
      title="Running a user command"
      description="A command entered directly in shell mode remains active and streams its captured output."
      document={standaloneShellRunningDocument}
      width="720px"
      shellToolDefaultOpen
    />
  ),
}

export const UserCommandCompleted = {
  render: () => (
    <CurrentSessionTimelineStory
      title="User command completed"
      description="A direct shell command keeps its final output and successful exit status in the transcript."
      document={standaloneShellCompletedDocument}
      width="720px"
      shellToolDefaultOpen
    />
  ),
}

export const CollapsedShell = {
  render: () => (
    <CurrentSessionTimelineStory
      title="Collapsed completed shell"
      description="A focused shell disclosure responds to the keyboard without scrolling its containing surface."
      document={terminalPassedDocument}
      width="720px"
    />
  ),
}

export const TestsPassed = {
  render: () => (
    <CurrentSessionTimelineStory
      title="Tests passed"
      description="A completed focused check shows its command, output, and successful tool state."
      document={terminalPassedDocument}
      width="720px"
      shellToolDefaultOpen
    />
  ),
}

export const ExpandedShell = {
  render: () => (
    <CurrentSessionTimelineStory
      title="Expanded shell"
      description="The expanded shell separates the command from its output in a full-width card without a detail rail."
      document={expandedShellDocument}
      width="786px"
      shellToolDefaultOpen
    />
  ),
}

export const ExecuteCode = {
  render: () => (
    <CurrentSessionTimelineStory
      title="Execute code"
      description="A Code Mode execution shares the shell treatment: the code and its result split into a two-tone card."
      document={executeCodeDocument}
      width="786px"
      shellToolDefaultOpen
    />
  ),
}

export const TestFailed = {
  render: () => (
    <CurrentSessionTimelineStory
      title="Test failed"
      description="A normal non-zero test result keeps the command and actionable failure message together."
      document={terminalFailedDocument}
      width="720px"
      shellToolDefaultOpen
    />
  ),
}

export const FixedAndPassed = {
  render: () => (
    <CurrentSessionTimelineStory
      title="Fixed and passed"
      description="The agent reproduces a failure, makes one correction, and reruns the package checks successfully."
      document={recoveryDocument}
      width="860px"
      editToolDefaultOpen
      shellToolDefaultOpen
    />
  ),
}
