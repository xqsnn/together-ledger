CREATE TABLE `comment_likes` (
	`comment_id` text NOT NULL,
	`owner_key` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`comment_id`, `owner_key`),
	FOREIGN KEY (`comment_id`) REFERENCES `comments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `comments` ADD `parent_id` text REFERENCES comments(id) ON DELETE cascade;--> statement-breakpoint
ALTER TABLE `comments` ADD `reply_to_owner` text;--> statement-breakpoint
CREATE INDEX `comments_parent_idx` ON `comments` (`parent_id`);