CREATE TABLE `session_prompt_admission` (
	`session_id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`prompt` text NOT NULL,
	`message` text NOT NULL,
	CONSTRAINT `session_prompt_admission_pk` PRIMARY KEY(`session_id`, `idempotency_key`),
	CONSTRAINT `fk_session_prompt_admission_session_id_session_id_fk` FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON DELETE CASCADE
);
