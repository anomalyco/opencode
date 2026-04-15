import { getPool } from "./db.pg";
import { getDb } from "./db.pg";
import { ProjectTablePg } from "./schema.pg";
import { eq } from "drizzle-orm";
import { ProjectID } from "../project/schema";

export async function createProjectSimple(input: { name: string; tenantUserId: string }) {
	const id = ProjectID.makeUnsafe(crypto.randomUUID());
	const now = Date.now();

	await getPool().query(
		`insert into "project" ("id", "tenant_user_id", "worktree", "vcs", "name", "icon_url", "icon_color", "time_created", "time_updated", "time_initialized", "sandboxes", "commands") values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
		[id, input.tenantUserId, `/projects/${id}`, null, input.name, null, null, now, now, null, "[]", null],
	);

	const result = await getPool().query("select * from project where id = $1", [id]);
	const row = result.rows[0];
	if (!row) throw new Error("Failed to create project");

	const icon =
		row.icon_url || row.icon_color ? { url: row.icon_url ?? undefined, color: row.icon_color ?? undefined } : undefined;
	const project = {
		id: ProjectID.make(row.id),
		worktree: row.worktree,
		vcs: undefined,
		name: row.name ?? undefined,
		icon,
		time: {
			created: row.time_created,
			updated: row.time_updated,
			initialized: row.time_initialized ?? undefined,
		},
		sandboxes: row.sandboxes,
		commands: row.commands ?? undefined,
	};

	return { project, directory: `/projects/${id}` };
}

export async function listProjectsSimple(tenantUserId?: string) {
	const result = tenantUserId
		? await getPool().query("select * from project where tenant_user_id = $1", [tenantUserId])
		: await getPool().query("select * from project");

	return result.rows.map((row) => {
		const icon =
			row.icon_url || row.icon_color
				? { url: row.icon_url ?? undefined, color: row.icon_color ?? undefined }
				: undefined;
		return {
			id: ProjectID.make(row.id),
			worktree: row.worktree,
			vcs: undefined,
			name: row.name ?? undefined,
			icon,
			time: {
				created: row.time_created,
				updated: row.time_updated,
				initialized: row.time_initialized ?? undefined,
			},
			sandboxes: row.sandboxes,
			commands: row.commands ?? undefined,
		};
	});
}
