ALTER TABLE `session` ADD `cost` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `session` ADD `tokens_input` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `session` ADD `tokens_output` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `session` ADD `tokens_reasoning` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `session` ADD `tokens_cache_read` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `session` ADD `tokens_cache_write` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
WITH `usage` AS (
	SELECT
		`session_id`,
		SUM(COALESCE(CAST(json_extract(`data`, '$.cost') AS real), 0)) AS `cost`,
		SUM(COALESCE(CAST(json_extract(`data`, '$.tokens.input') AS integer), 0)) AS `tokens_input`,
		SUM(COALESCE(CAST(json_extract(`data`, '$.tokens.output') AS integer), 0)) AS `tokens_output`,
		SUM(COALESCE(CAST(json_extract(`data`, '$.tokens.reasoning') AS integer), 0)) AS `tokens_reasoning`,
		SUM(COALESCE(CAST(json_extract(`data`, '$.tokens.cache.read') AS integer), 0)) AS `tokens_cache_read`,
		SUM(COALESCE(CAST(json_extract(`data`, '$.tokens.cache.write') AS integer), 0)) AS `tokens_cache_write`
	FROM `part`
	WHERE json_extract(`data`, '$.type') = 'step-finish'
	GROUP BY `session_id`
)
UPDATE `session`
SET
	`cost` = COALESCE((SELECT `usage`.`cost` FROM `usage` WHERE `usage`.`session_id` = `session`.`id`), 0),
	`tokens_input` = COALESCE((SELECT `usage`.`tokens_input` FROM `usage` WHERE `usage`.`session_id` = `session`.`id`), 0),
	`tokens_output` = COALESCE((SELECT `usage`.`tokens_output` FROM `usage` WHERE `usage`.`session_id` = `session`.`id`), 0),
	`tokens_reasoning` = COALESCE((SELECT `usage`.`tokens_reasoning` FROM `usage` WHERE `usage`.`session_id` = `session`.`id`), 0),
	`tokens_cache_read` = COALESCE((SELECT `usage`.`tokens_cache_read` FROM `usage` WHERE `usage`.`session_id` = `session`.`id`), 0),
	`tokens_cache_write` = COALESCE((SELECT `usage`.`tokens_cache_write` FROM `usage` WHERE `usage`.`session_id` = `session`.`id`), 0);
