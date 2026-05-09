UPDATE `workspace` SET `time_used` = unixepoch() * 1000 WHERE `time_used` = 0;
