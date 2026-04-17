ALTER TABLE `user` ADD `time_joined` timestamp(3);--> statement-breakpoint
ALTER TABLE `user` ADD `role` enum('admin','member');