CREATE TABLE `session_create_admission` (
	`idempotency_key` text PRIMARY KEY,
	`contract` text NOT NULL,
	`session` text NOT NULL
);
