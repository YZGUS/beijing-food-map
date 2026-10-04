CREATE TABLE `entry_media` (
	`entry_id` text NOT NULL,
	`media_id` text NOT NULL,
	PRIMARY KEY(`entry_id`, `media_id`),
	FOREIGN KEY (`entry_id`) REFERENCES `entries`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`media_id`) REFERENCES `media`(`id`) ON UPDATE no action ON DELETE no action
);
