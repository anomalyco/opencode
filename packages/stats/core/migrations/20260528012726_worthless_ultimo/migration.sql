ALTER TABLE `geo_stat` ADD `provider` varchar(128) DEFAULT 'all' NOT NULL;--> statement-breakpoint
ALTER TABLE `geo_stat` ADD `model` varchar(256) DEFAULT 'all' NOT NULL;--> statement-breakpoint
ALTER TABLE `geo_stat` DROP INDEX `uniq_country_period`;--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_country_period` ON `geo_stat` (`grain`,`period_start`,`dataset`,`tier`,`client`,`source`,`provider`,`model`,`country`);--> statement-breakpoint
CREATE INDEX `idx_country_model` ON `geo_stat` (`model`,`country`,`grain`,`period_start`);
