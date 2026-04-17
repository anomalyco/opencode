CREATE TABLE `key_rate_limit` (
	`key` varchar(255) NOT NULL,
	`interval` varchar(12) NOT NULL,
	`count` int NOT NULL,
	CONSTRAINT PRIMARY KEY(`key`,`interval`)
);
