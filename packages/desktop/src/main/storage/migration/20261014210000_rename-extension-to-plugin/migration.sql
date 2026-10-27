ALTER TABLE `extension` RENAME TO `plugin`;
--> statement-breakpoint
CREATE VIEW `extension` AS SELECT `id`, `enabled`, `manifest`, `revision` FROM `plugin`;
