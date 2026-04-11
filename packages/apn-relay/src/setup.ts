import { sql } from "drizzle-orm"
import { db } from "./db"

export async function setup() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS device_registration (
      id varchar(36) NOT NULL,
      secret_hash varchar(64) NOT NULL,
      device_token varchar(255) NOT NULL,
      bundle_id varchar(255) NOT NULL,
      apns_env varchar(16) NOT NULL DEFAULT 'production',
      created_at bigint NOT NULL,
      updated_at bigint NOT NULL,
      PRIMARY KEY (id),
      UNIQUE KEY device_registration_secret_token_idx (secret_hash, device_token),
      KEY device_registration_secret_hash_idx (secret_hash)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `)

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS delivery_log (
      id varchar(36) NOT NULL,
      secret_hash varchar(64) NOT NULL,
      event_type varchar(32) NOT NULL,
      session_id varchar(255) NOT NULL,
      status varchar(16) NOT NULL,
      error varchar(1024) NULL,
      created_at bigint NOT NULL,
      PRIMARY KEY (id),
      KEY delivery_log_secret_hash_idx (secret_hash),
      KEY delivery_log_created_at_idx (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `)
}
