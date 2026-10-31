CREATE TABLE `categories` (
	`type` text NOT NULL,
	`name` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`type`, `name`)
);
--> statement-breakpoint
CREATE TABLE `owners` (
	`key` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `owners_name_unique` ON `owners` (`name`);