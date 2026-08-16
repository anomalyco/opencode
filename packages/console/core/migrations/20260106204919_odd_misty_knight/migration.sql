CREATE TABLE `ip_rate_limit` (
	`ip` varchar(45) NOT NULL,
	`interval` varchar(10) NOT NULL,
	`count` int NOT NULL,
	CONSTRAINT `ip_rate_limit_ip_interval_pk` PRIMARY KEY(`ip`,`interval`)
);
