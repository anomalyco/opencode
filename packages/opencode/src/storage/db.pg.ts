import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { Log } from "../util/log";
import { NamedError } from "@opencode-ai/util/error";
import z from "zod";
import * as schema from "./schema.pg";

export const NotFoundError = NamedError.create(
	"NotFoundError",
	z.object({
		message: z.string(),
	}),
);

const log = Log.create({ service: "db" });

let _pool: Pool | undefined;
let _db: ReturnType<typeof drizzle> | undefined;

export function getPool() {
	if (!_pool) {
		const connectionString = process.env.DATABASE_URL ?? "postgresql://veritly:veritly@localhost:5432/veritly";
		log.info("creating pool", { connectionString });
		_pool = new Pool({ connectionString });
	}
	return _pool;
}

export function getDb() {
	if (!_db) {
		_db = drizzle(getPool(), { schema });
	}
	return _db;
}

export const Database = {
	get db() {
		return getDb();
	},

	async initialize() {
		log.info("connecting to postgres...");
		await getPool().query("SELECT 1");
		log.info("postgres connected");
	},

	async close() {
		if (_pool) {
			await _pool.end();
			_pool = undefined;
			_db = undefined;
		}
	},
};
