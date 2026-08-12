CREATE TABLE `agent_memory` (
	`id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`session_id` text,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`metadata` text,
	`tags` text,
	`strength` integer DEFAULT 100 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_agent_memory_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `agent_memory_project_idx` ON `agent_memory` (`project_id`);--> statement-breakpoint
CREATE INDEX `agent_memory_type_idx` ON `agent_memory` (`type`);--> statement-breakpoint
CREATE INDEX `agent_memory_status_idx` ON `agent_memory` (`status`);--> statement-breakpoint
CREATE INDEX `agent_memory_project_type_idx` ON `agent_memory` (`project_id`,`type`);