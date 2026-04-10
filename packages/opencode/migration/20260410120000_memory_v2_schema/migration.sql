ALTER TABLE `memory` ADD COLUMN `scope` text NOT NULL DEFAULT 'project';--> statement-breakpoint
ALTER TABLE `memory` ADD COLUMN `description` text;--> statement-breakpoint
ALTER TABLE `memory` ADD COLUMN `agent` text;--> statement-breakpoint
ALTER TABLE `memory` ADD COLUMN `relevance_score` real NOT NULL DEFAULT 1.0;--> statement-breakpoint
ALTER TABLE `memory` ADD COLUMN `time_last_verified` integer;--> statement-breakpoint
ALTER TABLE `memory` ADD COLUMN `promoted_from` text;--> statement-breakpoint
CREATE INDEX `memory_agent_idx` ON `memory` (`agent`);--> statement-breakpoint
CREATE INDEX `memory_scope_idx` ON `memory` (`scope`);--> statement-breakpoint
CREATE INDEX `memory_project_scope_idx` ON `memory` (`project_path`, `scope`);--> statement-breakpoint
UPDATE `memory` SET `type` = 'project' WHERE `type` IN ('error-solution', 'build-command', 'config-pattern', 'general');--> statement-breakpoint
UPDATE `memory` SET `type` = 'user' WHERE `type` = 'preference';--> statement-breakpoint
UPDATE `memory` SET `type` = 'feedback' WHERE `type` = 'decision';
