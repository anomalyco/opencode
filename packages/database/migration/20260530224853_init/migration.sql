CREATE TABLE `entity` (
	`id` text PRIMARY KEY,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`content` text,
	`embedding` text,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `relation` (
	`id` text PRIMARY KEY,
	`source_id` text NOT NULL,
	`target_id` text NOT NULL,
	`type` text NOT NULL,
	`metadata` text,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_relation_source_id_entity_id_fk` FOREIGN KEY (`source_id`) REFERENCES `entity`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_relation_target_id_entity_id_fk` FOREIGN KEY (`target_id`) REFERENCES `entity`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `entity_type_idx` ON `entity` (`type`);--> statement-breakpoint
CREATE INDEX `entity_name_idx` ON `entity` (`name`);--> statement-breakpoint
CREATE INDEX `relation_source_idx` ON `relation` (`source_id`);--> statement-breakpoint
CREATE INDEX `relation_target_idx` ON `relation` (`target_id`);--> statement-breakpoint
CREATE INDEX `relation_type_idx` ON `relation` (`type`);--> statement-breakpoint
CREATE INDEX `relation_source_type_idx` ON `relation` (`source_id`,`type`);