CREATE TABLE `branches` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`city` text DEFAULT '北京' NOT NULL,
	`address` text NOT NULL,
	`lat` real,
	`lng` real,
	`match_key` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `branches_match_key_unique` ON `branches` (`match_key`);--> statement-breakpoint
CREATE TABLE `comments` (
	`id` text PRIMARY KEY NOT NULL,
	`entry_id` text NOT NULL,
	`user_id` text NOT NULL,
	`display_name` text NOT NULL,
	`body` text NOT NULL,
	`ate_claim` integer DEFAULT 0 NOT NULL,
	`request_key` text NOT NULL,
	`payload_hash` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`entry_id`) REFERENCES `entries`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `comment_request` ON `comments` (`user_id`,`request_key`);--> statement-breakpoint
CREATE TABLE `entries` (
	`id` text PRIMARY KEY NOT NULL,
	`branch_id` text NOT NULL,
	`dishes` text NOT NULL,
	`media_ids` text DEFAULT '[]' NOT NULL,
	`experience` text DEFAULT '' NOT NULL,
	`meal_date` text,
	`amount` real,
	`source_url` text,
	`provenance` text NOT NULL,
	`creator` text,
	`display_name` text DEFAULT '食单用户' NOT NULL,
	`request_key` text,
	`payload_hash` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `entry_request` ON `entries` (`creator`,`request_key`);--> statement-breakpoint
CREATE TABLE `likes` (
	`entry_id` text NOT NULL,
	`user_id` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`entry_id`, `user_id`),
	FOREIGN KEY (`entry_id`) REFERENCES `entries`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `media` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`object_key` text NOT NULL,
	`mime` text NOT NULL,
	`bytes` integer NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `media_object_key_unique` ON `media` (`object_key`);