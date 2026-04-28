ALTER TABLE `automation` ADD `directory` text NOT NULL DEFAULT '';--> statement-breakpoint
ALTER TABLE `automation_run` ADD `directory` text NOT NULL DEFAULT '';--> statement-breakpoint
UPDATE `automation_run`
SET `directory` = COALESCE(
  (SELECT `session`.`directory` FROM `session` WHERE `session`.`id` = `automation_run`.`session_id`),
  ''
);--> statement-breakpoint
UPDATE `automation`
SET `directory` = COALESCE(
  (
    SELECT `automation_run`.`directory`
    FROM `automation_run`
    WHERE `automation_run`.`automation_id` = `automation`.`id`
      AND `automation_run`.`directory` != ''
    ORDER BY `automation_run`.`time_created` ASC
    LIMIT 1
  ),
  (SELECT `session`.`directory` FROM `session` WHERE `session`.`id` = `automation`.`thread_id`),
  (
    SELECT `project`.`worktree`
    FROM `project`
    WHERE `project`.`id` = `automation`.`project_id`
      AND `automation`.`project_id` != 'global'
  ),
  ''
);--> statement-breakpoint
UPDATE `automation_run`
SET `directory` = COALESCE(
  NULLIF((SELECT `automation`.`directory` FROM `automation` WHERE `automation`.`id` = `automation_run`.`automation_id`), ''),
  NULLIF(`directory`, ''),
  ''
);--> statement-breakpoint
CREATE INDEX `automation_directory_idx` ON `automation` (`directory`);--> statement-breakpoint
CREATE INDEX `automation_run_directory_time_idx` ON `automation_run` (`directory`,`time_created`);
