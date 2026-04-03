ALTER TABLE `session` ADD `root_session_id` text;--> statement-breakpoint
CREATE INDEX `session_root_session_idx` ON `session` (`root_session_id`);
--> statement-breakpoint
UPDATE session SET root_session_id = id WHERE parent_id IS NULL;--> statement-breakpoint
WITH RECURSIVE tree AS (
  SELECT id, parent_id, id AS root_id FROM session WHERE parent_id IS NULL
  UNION ALL
  SELECT s.id, s.parent_id, t.root_id FROM session s JOIN tree t ON s.parent_id = t.id
)
UPDATE session SET root_session_id = (SELECT root_id FROM tree WHERE tree.id = session.id) WHERE root_session_id IS NULL;