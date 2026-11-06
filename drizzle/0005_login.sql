-- 增加登录：accounts 存两个身份的密码，sessions 存长期登录态，join_codes 存认领码。
-- entries 新增 created_by：记录「谁登录着记的这笔」，与归属 owner 解耦。
-- 注意：ALTER TABLE ADD COLUMN 不是幂等的，本迁移只执行一次。

CREATE TABLE IF NOT EXISTS `accounts` (
	`owner_key` text PRIMARY KEY NOT NULL,
	`password_hash` text NOT NULL,
	`password_salt` text NOT NULL,
	`iterations` integer DEFAULT 100000 NOT NULL,
	`failed_attempts` integer DEFAULT 0 NOT NULL,
	`locked_until` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_key` text NOT NULL,
	`created_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `sessions_owner_key_idx` ON `sessions` (`owner_key`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `sessions_expires_at_idx` ON `sessions` (`expires_at`);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `join_codes` (
	`owner_key` text PRIMARY KEY NOT NULL,
	`code_hash` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint

ALTER TABLE `entries` ADD `created_by` text;
--> statement-breakpoint

-- 存量记录：归属是 qing / hua 的视为本人记录，「共同」无法判断是谁记的，留空。
UPDATE `entries` SET `created_by` = `owner` WHERE `created_by` IS NULL AND `owner` IN ('qing', 'hua');
