CREATE TABLE `permission` (
	`project_id` text NOT NULL,
	`action` text NOT NULL,
	`resource` text NOT NULL,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `permission_pk` PRIMARY KEY(`project_id`, `action`, `resource`),
	CONSTRAINT `fk_permission_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE
);
