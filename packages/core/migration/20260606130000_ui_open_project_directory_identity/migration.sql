UPDATE `ui_open_project`
SET `directory` = (
  SELECT `project`.`worktree`
  FROM `project`
  WHERE `project`.`id` = `ui_open_project`.`project_id`
)
WHERE `directory` IS NULL;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_ui_open_project` (
  `view_id` text NOT NULL,
  `project_id` text NOT NULL,
  `directory` text NOT NULL,
  `position` integer NOT NULL,
  `expanded` integer NOT NULL,
  `time_created` integer NOT NULL,
  `time_updated` integer NOT NULL,
  CONSTRAINT `ui_open_project_pk` PRIMARY KEY(`view_id`, `directory`),
  CONSTRAINT `fk_ui_open_project_view_id_ui_project_view_id_fk` FOREIGN KEY (`view_id`) REFERENCES `ui_project_view`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_ui_open_project_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE,
  CONSTRAINT `ui_open_project_view_id_position_unique` UNIQUE(`view_id`,`position`)
);--> statement-breakpoint
INSERT OR IGNORE INTO `__new_ui_open_project`(
  `view_id`,
  `project_id`,
  `directory`,
  `position`,
  `expanded`,
  `time_created`,
  `time_updated`
)
SELECT
  `view_id`,
  `project_id`,
  `directory`,
  `position`,
  `expanded`,
  `time_created`,
  `time_updated`
FROM `ui_open_project`
WHERE `directory` IS NOT NULL
ORDER BY `position` ASC;--> statement-breakpoint
DROP TABLE `ui_open_project`;--> statement-breakpoint
ALTER TABLE `__new_ui_open_project` RENAME TO `ui_open_project`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
