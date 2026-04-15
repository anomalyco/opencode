import { pgTable, text, bigint, jsonb, index, primaryKey, integer } from "drizzle-orm/pg-core";

export const Timestamps = {
	time_created: bigint({ mode: "number" }).notNull(),
	time_updated: bigint({ mode: "number" }).notNull(),
};

export const ProjectTablePg = pgTable("project", {
	id: text().primaryKey(),
	tenant_user_id: text().notNull(),
	worktree: text().notNull(),
	vcs: text(),
	name: text(),
	icon_url: text(),
	icon_color: text(),
	...Timestamps,
	time_initialized: bigint({ mode: "number" }),
	sandboxes: jsonb().notNull().default([]),
	commands: jsonb(),
});

export const SessionTablePg = pgTable(
	"session",
	{
		id: text().primaryKey(),
		project_id: text()
			.notNull()
			.references(() => ProjectTablePg.id, { onDelete: "cascade" }),
		workspace_id: text(),
		parent_id: text(),
		slug: text().notNull(),
		directory: text().notNull(),
		title: text().notNull(),
		version: text().notNull(),
		share_url: text(),
		summary_additions: integer(),
		summary_deletions: integer(),
		summary_files: integer(),
		summary_diffs: jsonb(),
		revert: jsonb(),
		permission: jsonb(),
		...Timestamps,
		time_compacting: bigint({ mode: "number" }),
		time_archived: bigint({ mode: "number" }),
	},
	(table) => [
		index("session_project_idx").on(table.project_id),
		index("session_workspace_idx").on(table.workspace_id),
		index("session_parent_idx").on(table.parent_id),
	],
);

export const MessageTablePg = pgTable(
	"message",
	{
		id: text().primaryKey(),
		session_id: text()
			.notNull()
			.references(() => SessionTablePg.id, { onDelete: "cascade" }),
		...Timestamps,
		data: jsonb().notNull(),
	},
	(table) => [index("message_session_idx").on(table.session_id)],
);

export const PartTablePg = pgTable(
	"part",
	{
		id: text().primaryKey(),
		message_id: text()
			.notNull()
			.references(() => MessageTablePg.id, { onDelete: "cascade" }),
		session_id: text().notNull(),
		...Timestamps,
		data: jsonb().notNull(),
	},
	(table) => [index("part_message_idx").on(table.message_id), index("part_session_idx").on(table.session_id)],
);

export const TodoTablePg = pgTable(
	"todo",
	{
		session_id: text()
			.notNull()
			.references(() => SessionTablePg.id, { onDelete: "cascade" }),
		content: text().notNull(),
		status: text().notNull(),
		priority: text().notNull(),
		position: bigint({ mode: "number" }).notNull(),
		...Timestamps,
	},
	(table) => [
		primaryKey({ columns: [table.session_id, table.position] }),
		index("todo_session_idx").on(table.session_id),
	],
);

export const PermissionTablePg = pgTable("permission", {
	project_id: text()
		.primaryKey()
		.references(() => ProjectTablePg.id, { onDelete: "cascade" }),
	...Timestamps,
	data: jsonb().notNull(),
});
