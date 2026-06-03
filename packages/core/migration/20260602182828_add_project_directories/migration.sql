CREATE TABLE `project_directory` (
	`project_id` text NOT NULL,
	`directory` text NOT NULL,
	`type` text NOT NULL,
	`time_created` integer NOT NULL,
	CONSTRAINT `project_directory_pk` PRIMARY KEY(`project_id`, `directory`),
	CONSTRAINT `fk_project_directory_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE
);
