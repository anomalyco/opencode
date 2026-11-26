CREATE TABLE `model_user_recency` (
	`id` bigint AUTO_INCREMENT PRIMARY KEY,
	`dataset` varchar(64) NOT NULL DEFAULT 'all',
	`model` varchar(256) NOT NULL,
	`last_active_date` char(10) NOT NULL,
	`users` bigint NOT NULL DEFAULT 0,
	`window_start` char(10) NOT NULL,
	`window_end` char(10) NOT NULL,
	`created_at` datetime NOT NULL DEFAULT (now()),
	`updated_at` datetime NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `uniq_model_user_recency` UNIQUE INDEX(`dataset`,`model`,`last_active_date`)
);
--> statement-breakpoint
CREATE INDEX `idx_model_user_recency_model` ON `model_user_recency` (`model`,`last_active_date`);