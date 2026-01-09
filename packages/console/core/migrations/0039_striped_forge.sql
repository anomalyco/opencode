CREATE TABLE `benchmark` (
	`id` varchar(30) NOT NULL,
	`time_created` timestamp(3) NOT NULL DEFAULT (now()),
	`time_updated` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
	`time_deleted` timestamp(3),
	`model` varchar(64) NOT NULL,
	`agent` varchar(64) NOT NULL,
	`result` mediumtext NOT NULL,
	CONSTRAINT `benchmark_id_pk` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `time_created` ON `benchmark` (`time_created`);