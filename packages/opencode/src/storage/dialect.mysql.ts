import {
  mysqlTable,
  varchar,
  bigint as myBigint,
  index as myIndex,
  primaryKey as myPrimaryKey,
  foreignKey as myForeignKey,
  json,
  boolean as myBoolean,
} from "drizzle-orm/mysql-core"

// MySQL TEXT columns cannot be used as PRIMARY KEY without an index prefix.
// Since the dialect shim cannot know at column-construction time whether a
// column will become a PK / FK / index member, we map text() → varchar(MAX_LEN)
// uniformly. 255 is chosen so compound keys fit InnoDB's 3072-byte index limit
// under utf8mb4: 255 * 4 = 1020 bytes per column, so a 2-column compound key
// (e.g. control_account PK on (email, url)) is 2040 bytes — under the cap.
// Covers all known IDs (ses_/msg_/prj_), slugs, titles, emails, and URLs.
const VARCHAR_LEN = 255

// Wrap text() to intercept { mode: "json" } and route to json()
function text(nameOrConfig?: any, config?: any) {
  const resolvedConfig = typeof nameOrConfig === "object" && !Array.isArray(nameOrConfig) ? nameOrConfig : config
  if (resolvedConfig?.mode === "json") {
    const name = typeof nameOrConfig === "string" ? nameOrConfig : undefined
    return name ? json(name) : json()
  }
  if (typeof nameOrConfig === "string") return varchar(nameOrConfig, { length: VARCHAR_LEN })
  return varchar({ length: VARCHAR_LEN })
}

// Map SQLite integer() to MySQL bigint() (SQLite integer is 64-bit).
// Also intercept { mode: "boolean" } and route to boolean().
function integer(nameOrConfig?: any, config?: any) {
  const resolvedConfig = typeof nameOrConfig === "object" && !Array.isArray(nameOrConfig) ? nameOrConfig : config
  if (resolvedConfig?.mode === "boolean") {
    const name = typeof nameOrConfig === "string" ? nameOrConfig : undefined
    return name ? myBoolean(name) : myBoolean()
  }
  if (typeof nameOrConfig === "string") return myBigint(nameOrConfig, { mode: "number" })
  return myBigint({ mode: "number" })
}

export {
  mysqlTable as table,
  text,
  integer,
  myIndex as index,
  myPrimaryKey as primaryKey,
  myForeignKey as foreignKey,
}
