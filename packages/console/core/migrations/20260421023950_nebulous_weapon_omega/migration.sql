DROP TABLE `model_tpm_limit`;--> statement-breakpoint
ALTER TABLE `model_tpm_rate_limit` DROP PRIMARY KEY;--> statement-breakpoint
ALTER TABLE `model_tpm_rate_limit` ADD PRIMARY KEY (`id`,`interval`);