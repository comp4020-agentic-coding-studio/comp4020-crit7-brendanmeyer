ALTER TABLE `leave_requests` ADD `replaces_request_id` integer REFERENCES leave_requests(id);--> statement-breakpoint
ALTER TABLE `leave_requests` ADD `system_note` text;