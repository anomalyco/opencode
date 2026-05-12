ALTER TABLE `project` ADD `icon_url_override` text;
UPDATE `project` SET `icon_url_override` = `icon_url` WHERE `icon_url` IS NOT NULL;
