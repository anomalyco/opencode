import { activeQuestionRequest, questionPendingDocument } from "@opencode/session-ui/storybook"
import { SessionPreview } from "./story-model"
import { SettingsExperimental } from "@/settings/experimental/experimental"

export default {
  title: "OpenCode/Session/Question switch",
  id: "session-question-switch",
  component: SessionPreview,
  parameters: {
    layout: "fullscreen",
    // The components lab shows these Knobs and their replay buttons in its inspector.
    motion: ["Question"],
    docs: {
      description: {
        component:
          "Compare the original question cards with the New question UI experiment. With the experiment enabled, step through questions with ← and →. Its motion is off until Question dock motion is turned on under Knobs → Timeline → Question.",
      },
    },
  },
}

export const Experiments = {
  render: () => (
    <SessionPreview
      title="Choose a Session layout"
      description="opencode · question UI experiments"
      document={questionPendingDocument}
      request={{ type: "question", value: activeQuestionRequest }}
      side={<SettingsExperimental />}
    />
  ),
}

// Several questions of different lengths and kinds in a row.
export const QuestionSeries = {
  render: () => (
    <SessionPreview
      title="Decide what to build next"
      description="opencode · modular-session-ui"
      document={questionPendingDocument}
      request={{
        type: "question",
        value: {
          ...activeQuestionRequest,
          fields: [
            activeQuestionRequest.fields[0],
            {
              key: "eval",
              type: "string",
              title: "Eval",
              description: "Build the skill-trigger eval: the full list against a budgeted one, on real prompts?",
              options: [
                {
                  value: "build",
                  label: "Build the eval (Recommended)",
                  description: "Measurement only. No change to the product.",
                },
                {
                  value: "trim",
                  label: "Also trim our skills",
                  description: "Eval, plus shorten skill descriptions over 1,024 characters.",
                },
                { value: "later", label: "Not now", description: "Park it." },
              ],
              custom: true,
            },
            {
              ...activeQuestionRequest.fields[1],
              options: [...activeQuestionRequest.fields[1].options, { value: "diagnostics", label: "Diagnostics" }],
            },
            {
              key: "backup",
              type: "string",
              title: "Backup",
              description:
                "motion-lint has five unpushed commits on main, plus other branches and uncommitted edits. Push it to the private repo as a backup?",
              options: [
                {
                  value: "push",
                  label: "Push it (Recommended)",
                  description: "Commit the work in progress to a branch and push everything.",
                },
                { value: "local", label: "Leave local", description: "Don't push." },
              ],
              custom: true,
            },
            {
              key: "levers",
              type: "multiselect",
              title: "Levers",
              description: "Which levers should I build now?",
              options: [
                { value: "sweep", label: "Stale PR sweep" },
                { value: "diet", label: "Review diet" },
                { value: "ladder", label: "Resume ladder" },
                { value: "none", label: "None for now" },
              ],
            },
          ],
        },
      }}
    />
  ),
}

// A pick-any question with more answers than the dock has room for, then a short one.
export const LongList = {
  render: () => (
    <SessionPreview
      title="Polish the docs site"
      description="opencode · docs"
      document={questionPendingDocument}
      request={{
        type: "question",
        value: {
          ...activeQuestionRequest,
          fields: [
            {
              key: "details",
              type: "multiselect",
              title: "Details",
              description: "Which should the builder add next? Pick any.",
              options: [
                {
                  value: "typography",
                  label: "All typography (Recommended)",
                  description:
                    "Hanging punctuation, tabular figures, typesetting fixes, one label style, accent selection",
                },
                { value: "links", label: "Heading links", description: "Hover shows #, click copies the section link" },
                {
                  value: "contents",
                  label: "Sticky contents list",
                  description: "Section list in the margin on wide screens, highlights where you are",
                },
                { value: "sidenotes", label: "Sidenotes", description: "Margin notes on desktop, inline on phone" },
                { value: "glossary", label: "Glossary terms", description: "Dotted underline, definition on hover" },
                { value: "fade", label: "Scroll fade", description: "Fade the edge of anything that scrolls sideways" },
                { value: "code", label: "Highlighted code lines", description: "Tint the lines that matter" },
                { value: "verdict", label: "Verdict line", description: "Answer or decision first, in the header" },
                {
                  value: "checked",
                  label: "Checked / not checked",
                  description: "Marker for verified vs unverified claims",
                },
                {
                  value: "diagram",
                  label: "Diagram interaction",
                  description: "Hover highlights connections, click enlarges",
                },
                { value: "footer", label: "Footer", description: "Source path to copy, plus the date it was made" },
              ],
            },
            {
              key: "ship",
              type: "string",
              title: "Ship",
              description: "Ship them in one pull request?",
              options: [
                { value: "one", label: "One pull request" },
                { value: "split", label: "One per detail" },
              ],
            },
          ],
        },
      }}
    />
  ),
}

const longMobileOptions = [
  {
    value: "opt-1",
    label: "1. Incremental schema migration with dual-read verification (Recommended)",
    description:
      "Backfill every existing session row in bounded batches while reading from both tables and logging any mismatch before cutover.",
  },
  {
    value: "opt-2",
    label: "2. Blue-green SQLite snapshot swap on daemon restart",
    description:
      "Build a fresh projected database beside the live file during idle windows and atomically swap file descriptors once parity holds.",
  },
  {
    value: "opt-3",
    label: "3. Lazy per-session hydration on first transcript open",
    description:
      "Leave historical sessions untouched at startup and upgrade each transcript inside a single write transaction when opened.",
  },
  {
    value: "opt-4",
    label: "4. Shadow journal replay from durable event log",
    description:
      "Replay ordered session aggregate events into a new read-model table in the background without blocking active prompt drains.",
  },
  {
    value: "opt-5",
    label: "5. Read-only archive boundary for legacy schema versions",
    description:
      "Keep older transcripts viewable through a frozen decoder while writing all newly admitted prompts exclusively to the v4 tables.",
  },
  {
    value: "opt-6",
    label: "6. Checkpoint compaction before running structural DDL",
    description:
      "Truncate the write-ahead log, vacuum dead pages, and verify foreign-key integrity prior to adding the new composite indexes.",
  },
  {
    value: "opt-7",
    label: "7. Partitioned attachment metadata with external blob refs",
    description:
      "Move inline base64 tool outputs into content-addressed files on disk so mobile queries never scan oversized row payloads.",
  },
  {
    value: "opt-8",
    label: "8. Staged rollout gated by workspace recovery marker",
    description:
      "Enable the new projection only after all claimed top-level sessions finish draining cleanly without pending inbox items.",
  },
  {
    value: "opt-9",
    label: "9. Deterministic fixture verification before live migration",
    description:
      "Clone the workspace header and sample fifty recent conversations into a temporary file to benchmark query plans first.",
  },
  {
    value: "opt-10",
    label: "10. Reversible trigger mirror between v3 and v4 columns",
    description:
      "Install temporary SQLite triggers that keep old and new columns synchronized so an older binary can still open the workspace.",
  },
  {
    value: "opt-11",
    label: "11. Offline CLI migration subcommand with progress bar",
    description:
      "Require explicit operator confirmation via opencode db migrate and refuse automatic background writes on startup.",
  },
  {
    value: "opt-12",
    label: "12. Clean slate rebuild of derived read projections only",
    description:
      "Drop disposable summary caches and rebuild every read projection directly from the canonical event history on boot.",
  },
]

const tallMobilePrompt = [
  "Before I run the workspace storage migration on this repository, please review the full rollout plan and confirm how failure recovery should behave if the connection drops mid-run.",
  "Step 1 inspects the active SQLite write-ahead log, verifies that no other local coordinator currently holds a busy execution claim, and records the starting event sequence number in a durable checkpoint row.",
  "Step 2 scans session_inbox for any unconsumed user or synthetic items so steered prompts admitted right before shutdown remain preserved in exact enqueue order without duplicate delivery.",
  "Step 3 creates the new normalized message part tables beside the existing transcript projection, keeping every original row intact until row counts, byte checksums, and foreign-key constraints match across all sessions.",
  "Step 4 streams large diff and terminal output blobs out of inline JSON columns into content-addressed storage files, preventing multi-megabyte rows from stalling mobile timeline queries over remote tunnels.",
  "Step 5 rebuilds the full-text search index and session summary projections in slices of twenty-five conversations per transaction, yielding between slices so interactive HTTP requests and live SSE updates stay responsive.",
  "Step 6 validates cursor pagination from both ends of the longest session timeline, checking that sticky tool headers, collapsed reasoning blocks, and pending permission or question docks restore to identical state.",
  "Step 7 writes a reversible compatibility view so older CLI processes inspecting the same directory fail gracefully with a clear upgrade message rather than corrupting partially migrated state.",
  "Step 8 runs PRAGMA integrity_check and compares aggregate token, cost, and tool-call totals before and after the projection swap to catch any silent truncation in historical metadata.",
  "Step 9 retains the pre-migration backup snapshot in the cache directory for seven days so you can roll back with a single command if any downstream script or plugin depends on the legacy layout.",
  "Step 10 revalidates workspace permissions, active MCP server tool bindings, and pending form or elicitation state so an in-flight agent session resumes cleanly without re-prompting for completed answers.",
  "Step 11 checks disk free space on both the database volume and temporary directory before committing the final rename, ensuring low-storage mobile hosts and containers never wedge mid-checkpoint.",
  "Step 12 emits a structured migration summary event with elapsed wall time, migrated row counts, reclaimed page bytes, and fallback instructions for operators monitoring remote headless servers.",
  "If a power loss, SIGKILL, or mobile network timeout interrupts any of these steps before the final checkpoint commits, how should the server handle the unfinished migration when it starts back up?",
].join(" ")

// Twelve verbose options followed by a question prompt taller than a phone viewport.
export const LongPrompt = {
  render: () => (
    <SessionPreview
      title="Plan the storage migration"
      description="opencode · storage-rollout"
      document={questionPendingDocument}
      request={{
        type: "question",
        value: {
          ...activeQuestionRequest,
          fields: [
            {
              key: "strategy",
              type: "string",
              title: "Strategy",
              description: "Which migration strategy should I use for existing workspace sessions?",
              options: longMobileOptions,
              custom: true,
            },
            {
              key: "recovery",
              type: "string",
              title: "Recovery",
              description: tallMobilePrompt,
              options: [
                {
                  value: "resume",
                  label: "Resume from the last committed slice (Recommended)",
                  description: "Continue from the recorded checkpoint sequence without repeating verified batches.",
                },
                {
                  value: "rollback",
                  label: "Roll back to the pre-migration snapshot automatically",
                  description: "Restore the original file immediately and surface a diagnostic toast in the session.",
                },
                {
                  value: "pause",
                  label: "Pause startup recovery and ask before retrying",
                  description: "Keep the workspace read-only until an explicit retry or rollback choice is confirmed.",
                },
                {
                  value: "rebuild",
                  label: "Discard partial projections and replay from scratch",
                  description: "Drop the incomplete target tables and restart a fresh pass from event sequence zero.",
                },
                {
                  value: "readonly",
                  label: "Serve existing sessions read-only while retrying in background",
                  description: "Allow browsing transcripts immediately and unlock new prompts once parity finishes.",
                },
                {
                  value: "export",
                  label: "Export a diagnostic bundle and halt migration",
                  description: "Write schema stats and mismatch logs to disk without touching the live workspace.",
                },
              ],
              custom: true,
            },
          ],
        },
      }}
    />
  ),
}
