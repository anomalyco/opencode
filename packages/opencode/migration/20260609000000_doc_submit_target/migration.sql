-- Generalize doc_submit over its target so the consent machine drives both prompt-doc sends and
-- AI question replies. Adds target_kind/target_id, makes doc_id nullable (null for question votes),
-- and re-keys the pending-unique constraint to (session, target_kind, target_id).
-- doc_submit holds only transient in-flight votes; recreate empty (its child doc_submit_actor must
-- be recreated alongside it for the FK). Any vote in flight across this migration is dropped — the
-- requester simply retries. Historical consent is already snapshotted into prompt_cycle_input.
DROP TABLE IF EXISTS `doc_submit_actor`;--> statement-breakpoint
DROP TABLE IF EXISTS `doc_submit`;--> statement-breakpoint
CREATE TABLE `doc_submit` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`target_kind` text DEFAULT 'doc' NOT NULL,
	`target_id` text NOT NULL,
	`doc_id` text,
	`actor_id` text NOT NULL,
	`status` text NOT NULL,
	`prompt` text NOT NULL,
	`timeout_ms` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`cancelled_by` text,
	`user_message_id` text,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`doc_id`) REFERENCES `doc`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `doc_submit_session_target_status_idx` ON `doc_submit` (`session_id`,`target_id`,`status`);--> statement-breakpoint
CREATE INDEX `doc_submit_expires_idx` ON `doc_submit` (`expires_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `doc_submit_pending_unique` ON `doc_submit` (`session_id`,`target_kind`,`target_id`) WHERE `status` = 'pending';--> statement-breakpoint
CREATE TABLE `doc_submit_actor` (
	`submit_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`name` text NOT NULL,
	`status` text NOT NULL,
	`time_responded` integer,
	PRIMARY KEY(`submit_id`, `actor_id`),
	FOREIGN KEY (`submit_id`) REFERENCES `doc_submit`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `doc_submit_actor_actor_idx` ON `doc_submit_actor` (`actor_id`);
