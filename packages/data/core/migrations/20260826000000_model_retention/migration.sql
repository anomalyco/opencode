CREATE TABLE `model_retention` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`cohort_date` char(10) NOT NULL,
	`dataset` varchar(64) NOT NULL DEFAULT 'all',
	`tier` varchar(64) NOT NULL DEFAULT 'all',
	`provider` varchar(128) NOT NULL,
	`model` varchar(256) NOT NULL,
	`eligible_users` bigint NOT NULL DEFAULT 0,
	`retained_users` bigint NOT NULL DEFAULT 0,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `model_retention_id` PRIMARY KEY(`id`),
	CONSTRAINT `uniq_model_retention_cohort` UNIQUE(`cohort_date`,`dataset`,`tier`,`provider`,`model`)
);
--> statement-breakpoint
CREATE INDEX `idx_model_retention_recent` ON `model_retention` (`dataset`,`tier`,`cohort_date`);
--> statement-breakpoint
CREATE INDEX `idx_model_retention_model` ON `model_retention` (`model`,`cohort_date`);
