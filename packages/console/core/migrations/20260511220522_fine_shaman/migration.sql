CREATE TABLE `model_tps_rate_limit` (
	`id` varchar(255) NOT NULL,
	`interval` bigint NOT NULL,
	`qualify` int NOT NULL,
	`unqualify` int NOT NULL,
	CONSTRAINT PRIMARY KEY(`id`,`interval`)
);
