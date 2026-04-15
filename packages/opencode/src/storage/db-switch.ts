import { lazy } from "../util/lazy";
import { Log } from "../util/log";

const log = Log.create({ service: "db-switch" });

const usePg = process.env.DATABASE_URL?.startsWith("postgresql://");

if (usePg) {
	log.info("using postgresql", { url: process.env.DATABASE_URL });
} else {
	log.info("using sqlite", { path: process.env.OPENCODE_DB_PATH ?? "default" });
}

export const Database = usePg ? require("./db.pg").Database : require("./db").Database;

export const schema = usePg ? require("./schema.pg") : require("./schema");
