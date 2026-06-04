CREATE TEMP TABLE `project_worktree_canonical` (
  `old_id` text PRIMARY KEY,
  `new_id` text NOT NULL
);--> statement-breakpoint
INSERT INTO `project_worktree_canonical` (`old_id`, `new_id`)
SELECT
  `project`.`id`,
  (
    SELECT `canonical`.`id`
    FROM `project` AS `canonical`
    WHERE `canonical`.`worktree` = `project`.`worktree`
    ORDER BY
      `canonical`.`time_updated` DESC,
      `canonical`.`time_created` DESC,
      `canonical`.`id` DESC
    LIMIT 1
  )
FROM `project`
WHERE `project`.`worktree` IN (
  SELECT `worktree`
  FROM `project`
  GROUP BY `worktree`
  HAVING COUNT(*) > 1
);--> statement-breakpoint
DELETE FROM `project_worktree_canonical`
WHERE `old_id` = `new_id`;--> statement-breakpoint
UPDATE `session`
SET `project_id` = (
  SELECT `new_id`
  FROM `project_worktree_canonical`
  WHERE `old_id` = `session`.`project_id`
)
WHERE `project_id` IN (
  SELECT `old_id`
  FROM `project_worktree_canonical`
);--> statement-breakpoint
UPDATE `workspace`
SET `project_id` = (
  SELECT `new_id`
  FROM `project_worktree_canonical`
  WHERE `old_id` = `workspace`.`project_id`
)
WHERE `project_id` IN (
  SELECT `old_id`
  FROM `project_worktree_canonical`
);--> statement-breakpoint
INSERT OR IGNORE INTO `project_directory` (`project_id`, `directory`, `type`, `time_created`)
SELECT
  `project_worktree_canonical`.`new_id`,
  `project_directory`.`directory`,
  `project_directory`.`type`,
  `project_directory`.`time_created`
FROM `project_directory`
JOIN `project_worktree_canonical`
ON `project_worktree_canonical`.`old_id` = `project_directory`.`project_id`;--> statement-breakpoint
DELETE FROM `project_directory`
WHERE `project_id` IN (
  SELECT `old_id`
  FROM `project_worktree_canonical`
);--> statement-breakpoint
DELETE FROM `project`
WHERE `id` IN (
  SELECT `old_id`
  FROM `project_worktree_canonical`
);--> statement-breakpoint
DROP TABLE `project_worktree_canonical`;
