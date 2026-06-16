-- Collapse any pre-existing duplicate pending submits before enforcing uniqueness.
-- Keep the most recent pending submit per (session, doc); expire the rest.
UPDATE `doc_submit` SET `status` = 'expired'
WHERE `status` = 'pending' AND `id` NOT IN (
	SELECT MAX(`id`) FROM `doc_submit` WHERE `status` = 'pending' GROUP BY `session_id`, `doc_id`
);
--> statement-breakpoint
CREATE UNIQUE INDEX `doc_submit_pending_unique` ON `doc_submit` (`session_id`,`doc_id`) WHERE `status` = 'pending';
