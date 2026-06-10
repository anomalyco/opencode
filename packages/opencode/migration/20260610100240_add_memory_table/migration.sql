CREATE TABLE `memory` (
	`id` text PRIMARY KEY,
	`content` text NOT NULL,
	`embedding` text,
	`metadata` text,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `memory_content_idx` ON `memory` (`content`);