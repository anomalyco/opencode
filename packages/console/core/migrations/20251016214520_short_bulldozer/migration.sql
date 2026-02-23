CREATE TABLE `auth` (
	`id` varchar(30) NOT NULL,
	`time_created` timestamp(3) NOT NULL DEFAULT (now()),
	`time_updated` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
	`time_deleted` timestamp(3),
	`provider` enum('email','github','google') NOT NULL,
	`subject` varchar(255) NOT NULL,
	`account_id` varchar(30) NOT NULL,
	CONSTRAINT `provider` UNIQUE(`provider`,`subject`)
);
