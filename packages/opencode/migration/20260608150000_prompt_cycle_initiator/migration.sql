-- The actor who initiated the send: submit creator (multi-party) or lone sender (solo).
ALTER TABLE `prompt_cycle_input` ADD `initiator_actor_id` text;
