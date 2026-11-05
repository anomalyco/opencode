---
title: Use Drizzle ORM with Bun
sidebarTitle: Drizzle with Bun
mode: center
---

Drizzle is an ORM that supports both a SQL-like "query builder" API and an ORM-like [Queries API](https://orm.drizzle.team/docs/rqb). It supports the `bun:sqlite` built-in module.

---

Let's get started by creating a fresh project with `bun init` and installing Drizzle.

```sh terminal icon="terminal"
bun init -y
bun add drizzle-orm
bun add -D drizzle-kit
```

---

Then we'll connect to a SQLite database using the `bun:sqlite` module and create the Drizzle database instance.

```ts db.ts icon="/icons/typescript.svg"
import { drizzle } from "drizzle-orm/bun-sqlite";
import { Database } from "bun:sqlite";

const sqlite = new Database("sqlite.db");
export const db = drizzle(sqlite);
```

---

To see the database in action, add these lines to `index.ts`.

```ts index.ts icon="/icons/typescript.svg"
import { db } from "./db";
import { sql } from "drizzle-orm";

const query = sql`select "hello world" as text`;
const result = db.get<{ text: string }>(query);
console.log(result);
```

---

Then run `index.ts` with Bun. Bun will automatically create `sqlite.db` and execute the query.

```sh terminal icon="terminal"
bun run index.ts
```

```txt
{
  text: "hello world"
}
```

---

Lets give our database a proper schema. Create a `schema.ts` file and define a `movies` table.

```ts schema.ts icon="/icons/typescript.svg"
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const movies = sqliteTable("movies", {
  id: integer("id").primaryKey(),
  title: text("name"),
  releaseYear: integer("release_year"),
});
```

---

We can use the `drizzle-kit` CLI to generate an initial SQL migration.

```sh terminal icon="terminal"
bunx drizzle-kit generate --dialect sqlite --schema ./schema.ts
```

---

This creates a new `drizzle` directory containing a `.sql` migration file and `meta` directory.

```txt File Tree icon="folder-tree"
drizzle
├── 0000_ordinary_beyonder.sql
└── meta
    ├── 0000_snapshot.json
    └── _journal.json
```

---

We can execute these migrations with a `migrate.ts` script.

This script creates a new connection to a SQLite database that writes to `sqlite.db`, then executes all unexecuted migrations in the `drizzle` directory.

```ts migrate.ts icon="/icons/typescript.svg"
import { migrate } from "drizzle-orm/bun-sqlite/migrator";

import { drizzle } from "drizzle-orm/bun-sqlite";
import { Database } from "bun:sqlite";

const sqlite = new Database("sqlite.db");
const db = drizzle(sqlite);
migrate(db, { migrationsFolder: "./drizzle" });
```

---

We can run this script with `bun` to execute the migration.

```sh terminal icon="terminal"
bun run migrate.ts
```

---

Now that we have a database, let's add some data to it. Create a `seed.ts` file with the following contents.

```ts seed.ts icon="/icons/typescript.svg"
import { db } from "./db";
import * as schema from "./schema";

await db.insert(schema.movies).values([
  {
    title: "The Matrix",
    releaseYear: 1999,
  },
  {
    title: "The Matrix Reloaded",
    releaseYear: 2003,
  },
  {
    title: "The Matrix Revolutions",
    releaseYear: 2003,
  },
]);

console.log(`Seeding complete.`);
```

---

Then run this file.

```sh terminal icon="terminal"
bun run seed.ts
```

```txt
Seeding complete.
```

---

We finally have a database with a schema and some sample data. Let's use Drizzle to query it. Replace the contents of `index.ts` with the following.

```ts index.ts icon="/icons/typescript.svg"
import * as schema from "./schema";
import { db } from "./db";

const result = await db.select().from(schema.movies);
console.log(result);
```

---

Then run the file. You should see the three movies we inserted.

```sh terminal icon="terminal"
bun run index.ts
```

```txt
[
  {
    id: 1,
    title: "The Matrix",
    releaseYear: 1999
  }, {
    id: 2,
    title: "The Matrix Reloaded",
    releaseYear: 2003
  }, {
    id: 3,
    title: "The Matrix Revolutions",
    releaseYear: 2003
  }
]
```

---

Refer to the [Drizzle website](https://orm.drizzle.team/docs/overview) for complete documentation.
