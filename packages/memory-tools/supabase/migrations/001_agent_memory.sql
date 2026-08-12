-- Memory Tools Plugin - Supabase Migration
-- Run this SQL in your Supabase SQL Editor to create the agent_memory table
--
-- IMPORTANT: This table mirrors the local SQLite schema. The plugin will
-- push memories from local SQLite to this cloud table.

-- Create table
CREATE TABLE IF NOT EXISTS agent_memory (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  session_id TEXT,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  metadata JSONB,
  tags JSONB,
  strength INTEGER DEFAULT 100 NOT NULL,
  status TEXT DEFAULT 'active' NOT NULL,
  time_created BIGINT NOT NULL,
  time_updated BIGINT NOT NULL
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_agent_memory_project_id ON agent_memory(project_id);
CREATE INDEX IF NOT EXISTS idx_agent_memory_type ON agent_memory(type);
CREATE INDEX IF NOT EXISTS idx_agent_memory_status ON agent_memory(status);
CREATE INDEX IF NOT EXISTS idx_agent_memory_project_type ON agent_memory(project_id, type);

-- Row Level Security (optional but recommended)
-- Uncomment if you want RLS policies
-- ALTER TABLE agent_memory ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see their own memories (based on project_id ownership)
-- Create a policy like this for each user:
-- CREATE POLICY "Users can manage own memories" ON agent_memory
--   FOR ALL USING (auth.uid() IS NOT NULL);

-- Note: For personal use with PAT (service role key), RLS should be disabled
-- since the plugin uses the service role key. Run this if using RLS:
-- ALTER TABLE agent_memory DISABLE ROW LEVEL SECURITY;

-- Grant permissions (adjust as needed for your setup)
-- GRANT ALL ON agent_memory TO authenticated;
-- GRANT ALL ON agent_memory TO service_role;

COMMENT ON TABLE agent_memory IS 'Cloud backup of OpenCode AgentMemory. Mirrors local SQLite schema.';
