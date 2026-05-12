CREATE TABLE `workspace` (
	`id` text PRIMARY KEY,
	`branch` text,
	`project_id` text NOT NULL,
	`config` text NOT NULL,
	CONSTRAINT `fk_workspace_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE
);
