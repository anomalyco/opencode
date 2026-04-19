CREATE TABLE `push_delivery` (
	`id` text PRIMARY KEY,
	`subscription_id` text NOT NULL,
	`payload` text NOT NULL,
	`kind` text NOT NULL,
	`tag` text NOT NULL,
	`ttl_seconds` integer NOT NULL,
	`urgency` text NOT NULL,
	`attempt_count` integer NOT NULL,
	`next_attempt_at` integer NOT NULL,
	`last_error` text,
	`last_status` integer,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL
);
