CREATE TABLE `doc_asset` (
	`id` text NOT NULL,
	`doc_id` text NOT NULL,
	`mime` text NOT NULL,
	`data` blob NOT NULL,
	`size` integer NOT NULL,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `doc_asset_pk` PRIMARY KEY(`doc_id`,`id`),
	CONSTRAINT `fk_doc_asset_doc_id_doc_id_fk` FOREIGN KEY (`doc_id`) REFERENCES `doc`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `doc_asset_doc_idx` ON `doc_asset` (`doc_id`);
