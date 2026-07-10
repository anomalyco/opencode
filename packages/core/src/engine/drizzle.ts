// Drizzle integration: wire engine tables into the existing migration system
// Adds the engine_* tables to DrizzleKit migration generation

import {
  EventLogTable,
  CheckpointTable,
  CapabilityGraphTable,
  SessionMemoriesTable,
  AgentSelfTable,
  UserProfileTable,
  RepairMemoriesTable,
  SkillsTable,
} from "./sql"

// Register all engine tables for DrizzleKit schema generation
export const engineSchema = {
  eventLog: EventLogTable,
  checkpoint: CheckpointTable,
  capabilityGraph: CapabilityGraphTable,
  sessionMemories: SessionMemoriesTable,
  agentSelf: AgentSelfTable,
  userProfile: UserProfileTable,
  repairMemories: RepairMemoriesTable,
  skills: SkillsTable,
}

// Compatible view SQL - run after migration
export const engineViewSQL = `
CREATE VIEW IF NOT EXISTS compatible_messages AS
SELECT
    e.event_id AS id,
    e.session_id,
    CASE
        WHEN e.event_type = 'user_input' THEN 'user'
        WHEN e.event_type = 'agent_output' THEN 'assistant'
        WHEN e.event_type = 'tool_call' THEN 'tool'
        WHEN e.event_type = 'tool_result' THEN 'tool_result'
        ELSE 'system'
    END AS role,
    e.payload AS data,
    e.timestamp AS created_at,
    e.sequence_index AS sort_order
FROM event_log e
WHERE e.event_type IN (
    'user_input', 'agent_output', 'tool_call', 'tool_result',
    'task_start', 'state_transition'
)
ORDER BY e.sequence_index;
`

// To register with drizzle.config.ts, add this schema:
// import { engineSchema } from "@opencode-ai/core/engine"
// Then include in the schema object: { ...existingSchemas, ...engineSchema }

export * as EngineDrizzle from "./drizzle"
