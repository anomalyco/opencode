CREATE INDEX artifact_rollout
ON artifact (channel, name, distribution, time_created DESC, version DESC);
