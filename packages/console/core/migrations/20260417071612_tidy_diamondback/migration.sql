CREATE TABLE `model_rate_limit` (
	`key` varchar(255) NOT NULL,
	`interval` varchar(40) NOT NULL,
	`count` int NOT NULL,
	CONSTRAINT PRIMARY KEY(`key`,`interval`)
);
