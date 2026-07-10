-- Compatible view: projects event_log events as chat messages for TUI compatibility
-- The TUI queries this view and sees the same column names/types as the original message system

CREATE VIEW IF NOT EXISTS compatible_messages AS
SELECT
    e.event_id AS id,
    e.session_id,
    CASE
        WHEN e.event_type = 'user_input' THEN 'user'
        WHEN e.event_type = 'agent_output' THEN 'assistant'
        WHEN e.event_type = 'tool_call' THEN 'tool'
        WHEN e.event_type = 'tool_result' THEN 'tool_result'
        WHEN e.event_type = 'archive_summary' THEN 'system'
        ELSE 'system'
    END AS role,
    e.payload AS data,
    e.timestamp AS created_at,
    e.sequence_index AS sort_order,
    e.event_type,
    e.status,
    e.token_cost,
    e.duration_ms
FROM event_log e
WHERE e.event_type IN (
    'user_input',
    'agent_output',
    'tool_call',
    'tool_result',
    'task_start',
    'state_transition',
    'archive_summary',
    'filesystem_committed',
    'filesystem_conflict',
    'filesystem_rollback',
    'dag_generated',
    'planning_failed',
    'validation_passed',
    'validation_failed',
    'entropy_alert',
    'error_occurred'
)
ORDER BY e.sequence_index;

-- Archive scanning index (partial, excludes already-archived events)
CREATE INDEX IF NOT EXISTS idx_archive_scan
ON event_log(session_id, sequence_index)
WHERE event_type != 'archive_summary';
