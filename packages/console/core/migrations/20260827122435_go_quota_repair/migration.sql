CREATE TABLE `go_quota_repair` (
	`key_hash` varchar(64) PRIMARY KEY,
	`receipt_id` varchar(36) NOT NULL,
	`input` json NOT NULL,
	`result` json,
	`time_created` timestamp(3) NOT NULL DEFAULT (now())
);
