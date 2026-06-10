import { Database } from "bun:sqlite"

const EA_LAB_SCHEMA_VERSION = "1"

export function ensureEaLabSchema(db: Database) {
  db.exec("pragma journal_mode = wal")
  db.exec("pragma synchronous = normal")
  db.exec("pragma busy_timeout = 5000")
  db.exec(`
    create table if not exists ea_lab_meta (
      key text primary key,
      value text not null,
      updated_at integer not null
    );

    create table if not exists raw_event (
      id text primary key,
      event_type text not null,
      source text not null,
      session_id text,
      message_id text,
      tool_call_id text,
      created_at integer not null,
      payload_json text not null,
      redacted_text text not null,
      checksum text not null
    );

    create index if not exists raw_event_type_created_idx on raw_event(event_type, created_at);
    create index if not exists raw_event_session_created_idx on raw_event(session_id, created_at);
    create index if not exists raw_event_message_idx on raw_event(message_id);
    create index if not exists raw_event_checksum_idx on raw_event(checksum);

    create table if not exists evidence (
      id text primary key,
      evidence_type text not null,
      uri text,
      file_path text,
      commit_hash text,
      message_id text,
      experiment_id text,
      description text not null,
      created_at integer not null,
      checksum text
    );

    create virtual table if not exists evidence_fts using fts5(
      description,
      content='evidence',
      content_rowid='rowid'
    );

    create trigger if not exists evidence_ai after insert on evidence begin
      insert into evidence_fts(rowid, description) values (new.rowid, new.description);
    end;

    create trigger if not exists evidence_ad after delete on evidence begin
      insert into evidence_fts(evidence_fts, rowid, description) values ('delete', old.rowid, old.description);
    end;

    create trigger if not exists evidence_au after update on evidence begin
      insert into evidence_fts(evidence_fts, rowid, description) values ('delete', old.rowid, old.description);
      insert into evidence_fts(rowid, description) values (new.rowid, new.description);
    end;

    create table if not exists experiment (
      id text primary key,
      title text not null,
      symbol text not null,
      timeframe text not null,
      strategy text not null,
      hypothesis text not null,
      implementation_summary text not null,
      test_conditions_json text not null,
      metrics_json text not null,
      result_status text not null,
      stage text not null,
      overfit_risk text not null,
      created_at integer not null,
      updated_at integer not null
    );

    create index if not exists experiment_symbol_strategy_idx on experiment(symbol, strategy, timeframe);
    create index if not exists experiment_stage_status_idx on experiment(stage, result_status);

    create table if not exists experience (
      id text primary key,
      type text not null,
      situation text not null,
      trigger_conditions_json text not null,
      action_taken text not null,
      outcome text not null,
      lesson text not null,
      reuse_rule text not null,
      anti_rule text not null,
      confidence text not null,
      status text not null,
      last_verified_at integer,
      expires_at integer,
      created_at integer not null,
      updated_at integer not null
    );

    create virtual table if not exists experience_fts using fts5(
      situation,
      lesson,
      reuse_rule,
      anti_rule,
      content='experience',
      content_rowid='rowid'
    );

    create trigger if not exists experience_ai after insert on experience begin
      insert into experience_fts(rowid, situation, lesson, reuse_rule, anti_rule) values (new.rowid, new.situation, new.lesson, new.reuse_rule, new.anti_rule);
    end;

    create trigger if not exists experience_ad after delete on experience begin
      insert into experience_fts(experience_fts, rowid, situation, lesson, reuse_rule, anti_rule) values ('delete', old.rowid, old.situation, old.lesson, old.reuse_rule, old.anti_rule);
    end;

    create trigger if not exists experience_au after update on experience begin
      insert into experience_fts(experience_fts, rowid, situation, lesson, reuse_rule, anti_rule) values ('delete', old.rowid, old.situation, old.lesson, old.reuse_rule, old.anti_rule);
      insert into experience_fts(rowid, situation, lesson, reuse_rule, anti_rule) values (new.rowid, new.situation, new.lesson, new.reuse_rule, new.anti_rule);
    end;

    create index if not exists experience_type_status_idx on experience(type, status);
    create index if not exists experience_updated_idx on experience(updated_at);

    create table if not exists experience_evidence (
      experience_id text not null,
      evidence_id text not null,
      primary key (experience_id, evidence_id)
    );

    create table if not exists risk_gate_check (
      id text primary key,
      target_type text not null,
      target_id text not null,
      gate_name text not null,
      severity text not null,
      passed integer not null,
      reason text not null,
      created_at integer not null
    );

    create index if not exists risk_gate_check_target_idx on risk_gate_check(target_type, target_id, created_at);

    create table if not exists promotion_decision (
      id text primary key,
      experiment_id text not null,
      from_stage text not null,
      to_stage text not null,
      decision text not null,
      reason text not null,
      violated_gate_ids_json text not null,
      evidence_ids_json text not null,
      created_at integer not null
    );

    create index if not exists promotion_decision_experiment_idx on promotion_decision(experiment_id, created_at);

    create table if not exists handoff_log (
      id text primary key,
      session_id text not null,
      from_model_id text,
      to_model_id text,
      handoff_hash text not null,
      admitted_at integer,
      acked_at integer,
      status text not null,
      created_at integer not null
    );

    create index if not exists handoff_log_session_created_idx on handoff_log(session_id, created_at);
  `)
  upsertEaLabMeta(db, "ea_lab_schema_version", EA_LAB_SCHEMA_VERSION)
}

export function upsertEaLabMeta(db: Database, key: string, value: string) {
  db.query(
    "insert into ea_lab_meta (key, value, updated_at) values (?, ?, ?) on conflict(key) do update set value = excluded.value, updated_at = excluded.updated_at",
  ).run(key, value, Date.now())
}

export function readEaLabMeta(db: Database, key: string) {
  return db.query<{ value: string }, [string]>("select value from ea_lab_meta where key = ? limit 1").get(key)?.value
}
