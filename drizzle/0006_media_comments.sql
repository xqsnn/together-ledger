-- 收支记录图片与评论。旧表一律不动，本迁移只新增表与索引，可重复执行。

CREATE TABLE IF NOT EXISTS `comments` (
	`id` text PRIMARY KEY NOT NULL,
	`entry_id` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`entry_id`) REFERENCES `entries`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `comments_entry_idx` ON `comments` (`entry_id`,`created_at`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `media` (
	`id` text PRIMARY KEY NOT NULL,
	`entry_id` text,
	`comment_id` text,
	`storage` text NOT NULL,
	`mime` text NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`bytes` integer NOT NULL,
	`thumb_mime` text,
	`thumb_bytes` integer DEFAULT 0 NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`entry_id`) REFERENCES `entries`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`comment_id`) REFERENCES `comments`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "media_target_check" CHECK(("media"."entry_id" is not null) <> ("media"."comment_id" is not null)),
	CONSTRAINT "media_storage_check" CHECK("media"."storage" in ('r2','d1')),
	CONSTRAINT "media_thumb_check" CHECK("media"."thumb_mime" is null or "media"."thumb_mime" = 'image/jpeg')
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `media_entry_idx` ON `media` (`entry_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `media_comment_idx` ON `media` (`comment_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `media_created_idx` ON `media` (`created_at`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `media_blobs` (
	`media_id` text NOT NULL,
	`variant` text NOT NULL,
	`data` blob NOT NULL,
	PRIMARY KEY(`media_id`, `variant`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `media_deletions` (
	`media_id` text NOT NULL,
	`variant` text NOT NULL,
	`storage` text NOT NULL,
	`created_at` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` text NOT NULL,
	PRIMARY KEY(`media_id`, `variant`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `media_state` (
	`id` text PRIMARY KEY NOT NULL,
	`last_drain_at` text NOT NULL
);
