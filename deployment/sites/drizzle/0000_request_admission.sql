CREATE TABLE `bread_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`principal` text NOT NULL,
	`lane` text NOT NULL,
	`created_at` integer NOT NULL,
	`active_until` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `bread_created` ON `bread_requests` (`created_at`);--> statement-breakpoint
CREATE INDEX `bread_principal_created` ON `bread_requests` (`principal`,`created_at`);--> statement-breakpoint
CREATE INDEX `bread_active` ON `bread_requests` (`active_until`);--> statement-breakpoint
CREATE INDEX `bread_expiry` ON `bread_requests` (`expires_at`);