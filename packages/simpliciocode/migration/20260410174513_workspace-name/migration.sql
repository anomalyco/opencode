PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_workspace` (
	`id` text PRIMARY KEY,
	`type` text NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`branch` text,
	`directory` text,
	`extra` text,
	`project_id` text NOT NULL,
	CONSTRAINT `fk_workspace_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
INSERT INTO `__new_workspace`(`id`, `type`, `branch`, `name`, `directory`, `extra`, `project_id`) SELECT `id`, `type`, `branch`, `name`, `directory`, `extra`, `project_id` FROM `workspace`;--> statement-breakpoint
DROP TABLE `workspace`;--> statement-breakpoint
ALTER TABLE `__new_workspace` RENAME TO `workspace`;--> statement-breakpoint
PRAGMA foreign_keys=ON;