CREATE TABLE `escrow_states` (
	`project_id` text PRIMARY KEY NOT NULL,
	`escrow_address` text NOT NULL,
	`funded` integer DEFAULT false NOT NULL,
	`completed` integer DEFAULT false NOT NULL,
	`had_dispute` integer DEFAULT false NOT NULL,
	`required_funding_wei` text DEFAULT '0' NOT NULL,
	`contract_balance_wei` text DEFAULT '0' NOT NULL,
	`client_withdrawable_wei` text DEFAULT '0' NOT NULL,
	`freelancer_withdrawable_wei` text DEFAULT '0' NOT NULL,
	`remaining_milestones` integer DEFAULT 0 NOT NULL,
	`last_block_number` text,
	`last_synced_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `escrow_states_address_unique` ON `escrow_states` (`escrow_address`);--> statement-breakpoint
CREATE TABLE `milestones` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`position` integer NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`amount_wei` text NOT NULL,
	`deliverable_hash` text,
	`deliverable_uri` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`submitted_at` integer,
	`resolved_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `milestones_project_position_unique` ON `milestones` (`project_id`,`position`);--> statement-breakpoint
CREATE INDEX `milestones_project_status_idx` ON `milestones` (`project_id`,`status`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`freelancer_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`arbiter_address` text NOT NULL,
	`fee_amount_wei` text NOT NULL,
	`escrow_address` text,
	`factory_transaction_hash` text,
	`chain_id` integer DEFAULT 11155111 NOT NULL,
	`status` text DEFAULT 'deploying' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`freelancer_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `projects_client_status_idx` ON `projects` (`client_id`,`status`);--> statement-breakpoint
CREATE INDEX `projects_freelancer_status_idx` ON `projects` (`freelancer_id`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `projects_escrow_address_unique` ON `projects` (`escrow_address`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`role` text DEFAULT 'both' NOT NULL,
	`wallet_address` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_wallet_address_unique` ON `users` (`wallet_address`);