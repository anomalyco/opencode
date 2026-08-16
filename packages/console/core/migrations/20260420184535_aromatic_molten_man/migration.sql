CREATE TABLE `model_tpm_limit` (
	`id` varchar(255) NOT NULL,
	`interval` int NOT NULL,
	`count` int NOT NULL,
	CONSTRAINT PRIMARY KEY(`id`,`interval`)
);
