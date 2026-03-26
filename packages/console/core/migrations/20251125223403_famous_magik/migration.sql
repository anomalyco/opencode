CREATE TABLE `ip` (
	`ip` varchar(45) NOT NULL,
	`time_created` timestamp(3) NOT NULL DEFAULT (now()),
	`time_updated` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
	`time_deleted` timestamp(3),
	`usage` int,
	CONSTRAINT `ip_ip_pk` PRIMARY KEY(`ip`)
);
