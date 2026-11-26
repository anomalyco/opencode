/**
 * The PostgreSQL half of the session full-text index.
 *
 * SQLite owns its index through FTS5 plus triggers. PostgreSQL has no FTS5,
 * so the same shape is built from a stored tsvector column maintained by one
 * PL/pgSQL trigger function. Extraction, completion gating and trigger names
 * mirror search-index.ts so the state machine and build loop stay shared.
 */

export type Normalize = (expression: string) => string

export type PgTrigger = {
  readonly name: string
  readonly table: string
  readonly event: string
  readonly when?: string
}

const TEXT_FN = [
  "CREATE OR REPLACE FUNCTION session_search_text(p_source text) RETURNS text",
  "LANGUAGE sql STABLE AS $fn$",
  "  SELECT CASE",
  "    WHEN s.id IS NOT NULL THEN s.title",
  "    WHEN m.id IS NULL THEN NULL",
  "    WHEN m.type = 'compaction' THEN CASE",
  "      WHEN pg_input_is_valid(m.data, 'jsonb') AND (m.data::jsonb #>> '{status}') = 'completed'",
  "      THEN (m.data::jsonb #>> '{summary}') END",
  "    WHEN m.type = 'user' THEN CASE",
  "      WHEN pg_input_is_valid(m.data, 'jsonb') THEN (m.data::jsonb #>> '{text}') END",
  "    WHEN m.type = 'assistant' THEN (",
  "      SELECT string_agg(t, E'\\n\\n' ORDER BY o, k) FROM (",
  "        SELECT 0 AS o, p.ordinal AS k, ((p.data::jsonb) #>> '{text}') AS t",
  "        FROM session_part p",
  "        WHERE p.message_id = m.id AND p.type = 'text'",
  "          AND pg_input_is_valid(p.data, 'jsonb')",
  "        UNION ALL",
  "        SELECT 1 AS o, (c.ord - 1) AS k, (c.value #>> '{text}') AS t",
  "        FROM jsonb_array_elements(",
  "          CASE WHEN pg_input_is_valid(m.data, 'jsonb') AND jsonb_typeof(m.data::jsonb -> 'content') = 'array'",
  "               THEN m.data::jsonb -> 'content' ELSE '[]'::jsonb END",
  "        ) WITH ORDINALITY AS c(value, ord)",
  "        WHERE (c.value #>> '{type}') = 'text'",
  "      ) parts",
  "      WHERE t IS NOT NULL AND trim(t) <> ''",
  "    )",
  "  END",
  "  FROM (SELECT p_source AS id) q",
  "  LEFT JOIN session_v2 s ON s.id = q.id",
  "  LEFT JOIN session_message m ON m.id = q.id",
  "$fn$",
].join("\n")

const completed = [
  "CREATE OR REPLACE FUNCTION session_search_completed(p_data text) RETURNS boolean",
  "LANGUAGE sql IMMUTABLE AS $fn$",
  "  SELECT CASE WHEN pg_input_is_valid(p_data, 'jsonb')",
  "    THEN ((p_data::jsonb) #>> '{time,completed}') IS NOT NULL ELSE true END",
  "$fn$",
].join("\n")

export const createStatements = (normalize: Normalize): string[] => [
  "CREATE EXTENSION IF NOT EXISTS unaccent",
  completed,
  TEXT_FN,
  [
    "CREATE TABLE IF NOT EXISTS session_search (",
    "  source_id text PRIMARY KEY,",
    "  session_id text NOT NULL,",
    "  document tsvector NOT NULL",
    ")",
  ].join("\n"),
  "CREATE INDEX IF NOT EXISTS session_search_document_idx ON session_search USING gin (document)",
  "CREATE INDEX IF NOT EXISTS session_search_session_idx ON session_search (session_id)",
  [
    "CREATE OR REPLACE FUNCTION session_search_reindex(p_source text, p_session text) RETURNS void",
    "LANGUAGE plpgsql AS $fn$",
    "DECLARE txt text;",
    "BEGIN",
    "  DELETE FROM session_search WHERE source_id = p_source;",
    "  txt := session_search_text(p_source);",
    "  IF txt IS NOT NULL AND trim(txt) <> '' THEN",
    "    INSERT INTO session_search (source_id, session_id, document)",
    "    VALUES (p_source, p_session, to_tsvector('simple', left(" + normalize("txt") + ", 65536)));",
    "  END IF;",
    "END",
    "$fn$",
  ].join("\n"),
  [
    "CREATE OR REPLACE FUNCTION session_search_refresh() RETURNS trigger",
    "LANGUAGE plpgsql AS $fn$",
    "DECLARE src text; sid text;",
    "BEGIN",
    "  IF TG_TABLE_NAME = 'session_v2' THEN",
    "    src := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;",
    "    sid := src;",
    "  ELSIF TG_TABLE_NAME = 'session_message' THEN",
    "    src := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;",
    "    sid := CASE WHEN TG_OP = 'DELETE' THEN OLD.session_id ELSE NEW.session_id END;",
    "  ELSE",
    "    src := CASE WHEN TG_OP = 'DELETE' THEN OLD.message_id ELSE NEW.message_id END;",
    "    sid := CASE WHEN TG_OP = 'DELETE' THEN OLD.session_id ELSE NEW.session_id END;",
    "    -- A trigger WHEN clause cannot hold a subquery, so the parent gate lives here:",
    "    -- a part contributes text only once its assistant message has completed.",
    "    IF TG_OP <> 'DELETE' AND NOT EXISTS (",
    "      SELECT 1 FROM session_message m",
    "      WHERE m.id = src AND m.type = 'assistant' AND session_search_completed(m.data)",
    "    ) THEN",
    "      RETURN NULL;",
    "    END IF;",
    "  END IF;",
    "  IF TG_OP = 'DELETE' THEN",
    "    DELETE FROM session_search WHERE source_id = src;",
    "  ELSE",
    "    PERFORM session_search_reindex(src, sid);",
    "  END IF;",
    "  RETURN NULL;",
    "END",
    "$fn$",
  ].join("\n"),
]

/** The same gating SQLite's triggers use, expressed over text-typed JSON columns. */
export const triggers = (indexed: string): PgTrigger[] => {
  return [
    {
      name: "session_search_message_insert",
      table: "session_message",
      event: "INSERT",
      when: "NEW.type IN (" + indexed + ") AND (NEW.type <> 'assistant' OR session_search_completed(NEW.data))",
    },
    {
      name: "session_search_message_update",
      table: "session_message",
      event: "UPDATE OF type, data",
      when:
        "(NEW.type IN (" + indexed + ") AND (NEW.type <> 'assistant' OR session_search_completed(NEW.data))) OR (OLD.type IN (" + indexed + ") AND NEW.type NOT IN (" + indexed + "))",
    },
    { name: "session_search_message_delete", table: "session_message", event: "DELETE", when: "OLD.type IN (" + indexed + ")" },
    // PostgreSQL rejects subqueries in a trigger WHEN clause, so the parent gate
    // for parts lives in session_search_refresh() instead.
    { name: "session_search_part_insert", table: "session_part", event: "INSERT", when: "NEW.type = 'text'" },
    {
      name: "session_search_part_update",
      table: "session_part",
      event: "UPDATE OF type, data, ordinal",
      when: "(NEW.type = 'text' OR OLD.type = 'text')",
    },
    { name: "session_search_part_delete", table: "session_part", event: "DELETE", when: "OLD.type = 'text'" },
    {
      name: "session_search_session_insert",
      table: "session_v2",
      event: "INSERT",
      when: "trim(coalesce(NEW.title, '')) <> ''",
    },
    {
      name: "session_search_session_update",
      table: "session_v2",
      event: "UPDATE OF title",
      when: "NEW.title IS DISTINCT FROM OLD.title",
    },
    { name: "session_search_session_delete", table: "session_v2", event: "DELETE" },
  ]
}
