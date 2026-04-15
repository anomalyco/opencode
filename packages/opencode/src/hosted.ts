import { EOL } from "os";
import path from "path";
import { Global } from "./global";
import { Installation } from "./installation";
import { Server } from "./server/server";
import { Filesystem } from "./util/filesystem";
import { Log } from "./util/log";

const log = Log.create({ service: "hosted" });

process.on("unhandledRejection", (error) => {
	log.error("rejection", {
		error: error instanceof Error ? error.message : error,
	});
});

process.on("uncaughtException", (error) => {
	log.error("exception", {
		error: error instanceof Error ? error.message : error,
	});
	process.exit(1);
});

process.on("SIGHUP", () => process.exit());

await Log.init({
	print: process.argv.includes("--print-logs"),
	dev: Installation.isLocal(),
	level: Installation.isLocal() ? "DEBUG" : "INFO",
});

process.env.AGENT = "1";
process.env.OPENCODE = "1";
process.env.OPENCODE_PID = String(process.pid);

const usePg = process.env.DATABASE_URL?.startsWith("postgresql://");

if (usePg) {
	log.info("using postgresql", { url: process.env.DATABASE_URL });
	const { Database } = await import("./storage/db.pg");
	await Database.initialize();
	const { setupPostgresTables } = await import("./storage/setup-pg");
	await setupPostgresTables();
} else {
	log.info("using sqlite");
	const { Database, JsonMigration } = await import("./storage/db");
	const marker = path.join(Global.Path.data, "opencode.db");
	if (!(await Filesystem.exists(marker))) {
		process.stderr.write("Performing one time database migration, may take a few minutes..." + EOL);
		await JsonMigration.run(Database.Client().$client, {
			progress: (event) => {
				process.stderr.write(`sqlite-migration:${Math.floor((event.current / event.total) * 100)}` + EOL);
			},
		});
		process.stderr.write("Database migration complete." + EOL);
	}
}

const hostname = process.env.OPENCODE_SERVER_HOSTNAME ?? "0.0.0.0";
const port = Number(process.env.PORT ?? "3000");
const cors = process.env.OPENCODE_SERVER_CORS?.split(",")
	.map((value) => value.trim())
	.filter(Boolean);

const server = Server.listen({
	hostname,
	port,
	cors,
});

console.log(`opencode server listening on http://${server.hostname}:${server.port}`);

await new Promise(() => {});
