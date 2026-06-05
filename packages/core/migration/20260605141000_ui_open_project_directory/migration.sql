ALTER TABLE `ui_open_project` ADD COLUMN `directory` text;--> statement-breakpoint
ALTER TABLE `ui_project_view_last_project` ADD COLUMN `directory` text;--> statement-breakpoint
UPDATE `ui_open_project`
SET `directory` = (
  SELECT `project`.`worktree`
  FROM `project`
  WHERE `project`.`id` = `ui_open_project`.`project_id`
)
WHERE `directory` IS NULL;--> statement-breakpoint
UPDATE `ui_project_view_last_project`
SET `directory` = (
  SELECT `project`.`worktree`
  FROM `project`
  WHERE `project`.`id` = `ui_project_view_last_project`.`project_id`
)
WHERE `directory` IS NULL;
