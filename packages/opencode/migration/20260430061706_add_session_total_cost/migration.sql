ALTER TABLE `session` ADD `total_cost` real DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE `session` SET `total_cost` = COALESCE((
  SELECT SUM(json_extract(`m`.`data`, '$.cost'))
  FROM `message` AS `m`
  WHERE `m`.`session_id` = `session`.`id`
    AND json_extract(`m`.`data`, '$.role') = 'assistant'
), 0);