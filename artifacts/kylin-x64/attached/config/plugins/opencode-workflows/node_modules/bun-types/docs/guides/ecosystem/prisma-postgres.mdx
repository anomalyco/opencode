---
title: Use Prisma Postgres with Bun
sidebarTitle: Prisma Postgres with Bun
mode: center
---

<Note>
  **Note** — At the moment Prisma needs Node.js to be installed to run certain generation code. Make sure Node.js is
  installed in the environment where you're running `bunx prisma` commands.
</Note>

<Steps>
	<Step title="Create a new project">
		First, create a directory and initialize it with `bun init`.

    	```bash terminal icon="terminal"
    	mkdir prisma-postgres-app
    	cd prisma-postgres-app
    	bun init
    	```
    </Step>

    <Step title="Install Prisma dependencies">
    	Then install the Prisma CLI (`prisma`), Prisma Client (`@prisma/client`), and the accelerate extension as dependencies.

    	```bash terminal icon="terminal"
    	bun add -d prisma
    	bun add @prisma/client @prisma/extension-accelerate
    	```
    </Step>

    <Step title="Initialize Prisma with PostgreSQL">
    	We'll use the Prisma CLI with `bunx` to initialize our schema and migration directory. We'll be using PostgreSQL as our database.

    	```bash terminal icon="terminal"
    	bunx --bun prisma init --db
    	```

    	This creates a basic schema. We need to update it to use the new Rust-free client with Bun optimization. Open `prisma/schema.prisma` and modify the generator block, then add a `User` model.

    	```prisma prisma/schema.prisma icon="/icons/ecosystem/prisma.svg"
    	generator client {
    		provider = "prisma-client"
    		output = "./generated" // [!code ++]
    		engineType = "client" // [!code ++]
    		runtime = "bun" // [!code ++]
    	}

    	datasource db {
    		provider = "postgresql"
    		url      = env("DATABASE_URL")
    	}

    	model User { // [!code ++]
    		id    Int     @id @default(autoincrement()) // [!code ++]
    		email String  @unique // [!code ++]
    		name  String? // [!code ++]
    	} // [!code ++]
    	```
    </Step>

    <Step title="Configure database connection">
    	Set up your Postgres database URL in the `.env` file.

    	```ini .env icon="settings"
    	DATABASE_URL="postgresql://username:password@localhost:5432/mydb?schema=public"
    	```
    </Step>

    <Step title="Create and run database migration">
    	Then generate and run initial migration.

    	This will generate a `.sql` migration file in `prisma/migrations`, and execute the migration against your Postgres database.

    	```bash terminal icon="terminal"
    	bunx --bun prisma migrate dev --name init
    	```

    	```txt
    	Environment variables loaded from .env
    	Prisma schema loaded from prisma/schema.prisma
    	Datasource "db": PostgreSQL database "mydb", schema "public" at "localhost:5432"

    	Applying migration `20250114141233_init`

    	The following migration(s) have been created and applied from new schema changes:

    	prisma/migrations/
    	  └─ 20250114141233_init/
    	    └─ migration.sql

    	Your database is now in sync with your schema.

    	✔ Generated Prisma Client (6.17.1) to ./generated in 18ms
    	```
    </Step>

    <Step title="Generate Prisma Client">
    	As indicated in the output, Prisma re-generates our _Prisma client_ whenever we execute a new migration. The client provides a fully typed API for reading and writing from our database. You can manually re-generate the client with the Prisma CLI.

    	```sh terminal icon="terminal"
    	bunx --bun prisma generate
    	```
    </Step>

    <Step title="Initialize Prisma Client with Accelerate">
    	Now we need to create a Prisma client instance. Create a new file `prisma/db.ts` to initialize the PrismaClient with the Postgres adapter.

    	```ts prisma/db.ts icon="/icons/typescript.svg"
    	import { PrismaClient } from "./generated/client";
    	import { withAccelerate } from '@prisma/extension-accelerate'

    	export const prisma = new PrismaClient().$extends(withAccelerate())
    	```
    </Step>

    <Step title="Create a test script">
    	Let's write a script to create a new user, then count the number of users in the database.

    	```ts index.ts icon="/icons/typescript.svg"
    	import { prisma } from "./prisma/db";

    	// create a new user
    	await prisma.user.create({
    	  data: {
    	    name: "John Dough",
    	    email: `john-${Math.random()}@example.com`,
    	  },
    	});

    	// count the number of users
    	const count = await prisma.user.count();
    	console.log(`There are ${count} users in the database.`);
    	```
    </Step>

    <Step title="Run and test the application">
    	Let's run this script with `bun run`. Each time we run it, a new user is created.

    	```bash terminal icon="terminal"
    	bun run index.ts
    	```

    	```txt
    	There are 1 users in the database.
    	```

    	```bash terminal icon="terminal"
    	bun run index.ts
    	```

    	```txt
    	There are 2 users in the database.
    	```

    	```bash terminal icon="terminal"
    	bun run index.ts
    	```

    	```txt
    	There are 3 users in the database.
    	```
    </Step>

</Steps>

---

That's it! Now that you've set up Prisma Postgres using Bun, we recommend referring to the [official Prisma Postgres docs](https://www.prisma.io/docs/postgres) as you continue to develop your application.
