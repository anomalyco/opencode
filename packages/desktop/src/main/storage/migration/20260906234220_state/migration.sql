CREATE TABLE `state` (
	`name` text NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `state_pk` PRIMARY KEY(`name`, `key`)
);
