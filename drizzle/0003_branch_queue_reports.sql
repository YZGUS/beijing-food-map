CREATE TABLE `queue_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`branch_id` text NOT NULL,
	`user_id` text NOT NULL,
	`display_name` text NOT NULL,
	`observed_at` text NOT NULL,
	`wait_minutes` integer NOT NULL,
	`kind` text NOT NULL,
	`party_size` integer NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`request_key` text NOT NULL,
	`payload_hash` text NOT NULL,
	`created_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "queue_wait_range" CHECK("queue_reports"."wait_minutes" BETWEEN 0 AND 600),
	CONSTRAINT "queue_kind" CHECK("queue_reports"."kind" IN ('estimate','elapsed','actual')),
	CONSTRAINT "queue_party_range" CHECK("queue_reports"."party_size" BETWEEN 1 AND 20),
	CONSTRAINT "queue_note_length" CHECK(length("queue_reports"."note")<=250)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `queue_report_request` ON `queue_reports` (`user_id`,`request_key`);--> statement-breakpoint
CREATE INDEX `queue_report_branch_time` ON `queue_reports` (`branch_id`,`observed_at`);--> statement-breakpoint
CREATE INDEX `queue_report_user_time` ON `queue_reports` (`user_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `branches` ADD `location_source` text DEFAULT 'user' NOT NULL;
--> statement-breakpoint
UPDATE `branches` SET `location_source`='seed' WHERE EXISTS (SELECT 1 FROM `entries` WHERE `entries`.`branch_id`=`branches`.`id` AND `entries`.`provenance`='seed');
