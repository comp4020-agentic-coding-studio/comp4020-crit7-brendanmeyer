CREATE TABLE `leave_balances` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`person_id` integer NOT NULL,
	`leave_type_id` integer NOT NULL,
	`balance_hours` real DEFAULT 0 NOT NULL,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`leave_type_id`) REFERENCES `leave_types`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `leave_balances_person_type` ON `leave_balances` (`person_id`,`leave_type_id`);--> statement-breakpoint
CREATE TABLE `leave_requests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`person_id` integer NOT NULL,
	`leave_type_id` integer NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`hours_first_day` real NOT NULL,
	`hours_last_day` real NOT NULL,
	`hours_requested` real NOT NULL,
	`reason` text,
	`status` text DEFAULT 'submitted' NOT NULL,
	`cancellation_reason` text,
	`decided_by` integer,
	`decided_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`leave_type_id`) REFERENCES `leave_types`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`decided_by`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `leave_types` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`accrues` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE `people` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`title` text,
	`manager_id` integer,
	FOREIGN KEY (`manager_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
