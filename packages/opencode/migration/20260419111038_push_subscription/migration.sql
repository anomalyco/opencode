CREATE TABLE `push_subscription` (
	`id` text PRIMARY KEY,
	`endpoint` text NOT NULL,
	`p256dh` text NOT NULL,
	`auth` text NOT NULL,
	`expiration_time` integer,
	`enabled` integer NOT NULL,
	`notify_on_completion` integer NOT NULL,
	`notify_on_error` integer NOT NULL,
	`user_agent` text,
	`last_error` text,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL
);
