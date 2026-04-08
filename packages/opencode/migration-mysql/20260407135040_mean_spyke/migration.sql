CREATE TABLE `account_state` (
    `id` bigint PRIMARY KEY,
    `active_account_id` varchar(255),
    `active_org_id` varchar(255)
);
--> statement-breakpoint
CREATE TABLE `account` (
    `id` varchar(255) PRIMARY KEY,
    `email` varchar(255) NOT NULL,
    `url` varchar(255) NOT NULL,
    `access_token` varchar(255) NOT NULL,
    `refresh_token` varchar(255) NOT NULL,
    `token_expiry` bigint,
    `time_created` bigint NOT NULL,
    `time_updated` bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE `control_account` (
    `email` varchar(255) NOT NULL,
    `url` varchar(255) NOT NULL,
    `access_token` varchar(255) NOT NULL,
    `refresh_token` varchar(255) NOT NULL,
    `token_expiry` bigint,
    `active` boolean NOT NULL,
    `time_created` bigint NOT NULL,
    `time_updated` bigint NOT NULL,
    CONSTRAINT PRIMARY KEY (`email`, `url`)
);
--> statement-breakpoint
CREATE TABLE `workspace` (
    `id` varchar(255) PRIMARY KEY,
    `type` varchar(255) NOT NULL,
    `branch` varchar(255),
    `name` varchar(255),
    `directory` varchar(255),
    `extra` json,
    `project_id` varchar(255) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `project` (
    `id` varchar(255) PRIMARY KEY,
    `worktree` varchar(255) NOT NULL,
    `vcs` varchar(255),
    `name` varchar(255),
    `icon_url` varchar(255),
    `icon_color` varchar(255),
    `time_created` bigint NOT NULL,
    `time_updated` bigint NOT NULL,
    `time_initialized` bigint,
    `sandboxes` json NOT NULL,
    `commands` json
);
--> statement-breakpoint
CREATE TABLE `message` (
    `id` varchar(255) PRIMARY KEY,
    `session_id` varchar(255) NOT NULL,
    `time_created` bigint NOT NULL,
    `time_updated` bigint NOT NULL,
    `data` json NOT NULL
);
--> statement-breakpoint
CREATE TABLE `part` (
    `id` varchar(255) PRIMARY KEY,
    `message_id` varchar(255) NOT NULL,
    `session_id` varchar(255) NOT NULL,
    `time_created` bigint NOT NULL,
    `time_updated` bigint NOT NULL,
    `data` json NOT NULL
);
--> statement-breakpoint
CREATE TABLE `permission` (
    `project_id` varchar(255) PRIMARY KEY,
    `time_created` bigint NOT NULL,
    `time_updated` bigint NOT NULL,
    `data` json NOT NULL
);
--> statement-breakpoint
CREATE TABLE `opencode_session` (
    `id` varchar(255) PRIMARY KEY,
    `project_id` varchar(255) NOT NULL,
    `workspace_id` varchar(255),
    `parent_id` varchar(255),
    `slug` varchar(255) NOT NULL,
    `directory` varchar(255) NOT NULL,
    `title` varchar(255) NOT NULL,
    `version` varchar(255) NOT NULL,
    `share_url` varchar(255),
    `summary_additions` bigint,
    `summary_deletions` bigint,
    `summary_files` bigint,
    `summary_diffs` json,
    `revert` json,
    `permission` json,
    `time_created` bigint NOT NULL,
    `time_updated` bigint NOT NULL,
    `time_compacting` bigint,
    `time_archived` bigint
);
--> statement-breakpoint
CREATE TABLE `todo` (
    `session_id` varchar(255) NOT NULL,
    `content` varchar(255) NOT NULL,
    `status` varchar(255) NOT NULL,
    `priority` varchar(255) NOT NULL,
    `position` bigint NOT NULL,
    `time_created` bigint NOT NULL,
    `time_updated` bigint NOT NULL,
    CONSTRAINT PRIMARY KEY (`session_id`, `position`)
);
--> statement-breakpoint
CREATE TABLE `session_share` (
    `session_id` varchar(255) PRIMARY KEY,
    `id` varchar(255) NOT NULL,
    `secret` varchar(255) NOT NULL,
    `url` varchar(255) NOT NULL,
    `time_created` bigint NOT NULL,
    `time_updated` bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE `event_sequence` (
    `aggregate_id` varchar(255) PRIMARY KEY,
    `seq` bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE `event` (
    `id` varchar(255) PRIMARY KEY,
    `aggregate_id` varchar(255) NOT NULL,
    `seq` bigint NOT NULL,
    `type` varchar(255) NOT NULL,
    `data` json NOT NULL
);
--> statement-breakpoint
ALTER TABLE `message`
ADD KEY `message_session_time_created_id_idx` (
    `session_id`,
    `time_created`,
    `id`
);

ALTER TABLE `part`
ADD KEY `part_message_id_id_idx` (`message_id`, `id`);

ALTER TABLE `part` ADD KEY `part_session_idx` (`session_id`);

ALTER TABLE `opencode_session`
ADD KEY `session_project_idx` (`project_id`);

ALTER TABLE `opencode_session`
ADD KEY `session_workspace_idx` (`workspace_id`);

ALTER TABLE `opencode_session`
ADD KEY `session_parent_idx` (`parent_id`);

ALTER TABLE `todo` ADD KEY `todo_session_idx` (`session_id`);

ALTER TABLE `account_state`
ADD CONSTRAINT `account_state_active_account_id_account_id_fkey` FOREIGN KEY (`active_account_id`) REFERENCES `account` (`id`) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE `workspace`
ADD CONSTRAINT `workspace_project_id_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `project` (`id`) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE `message`
ADD CONSTRAINT `message_session_id_opencode_session_id_fkey` FOREIGN KEY (`session_id`) REFERENCES `opencode_session` (`id`) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE `part`
ADD CONSTRAINT `part_message_id_message_id_fkey` FOREIGN KEY (`message_id`) REFERENCES `message` (`id`) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE `permission`
ADD CONSTRAINT `permission_project_id_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `project` (`id`) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE `opencode_session`
ADD CONSTRAINT `opencode_session_project_id_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `project` (`id`) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE `todo`
ADD CONSTRAINT `todo_session_id_opencode_session_id_fkey` FOREIGN KEY (`session_id`) REFERENCES `opencode_session` (`id`) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE `session_share`
ADD CONSTRAINT `session_share_session_id_opencode_session_id_fkey` FOREIGN KEY (`session_id`) REFERENCES `opencode_session` (`id`) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE `event`
ADD CONSTRAINT `event_aggregate_id_event_sequence_aggregate_id_fkey` FOREIGN KEY (`aggregate_id`) REFERENCES `event_sequence` (`aggregate_id`) ON DELETE CASCADE;