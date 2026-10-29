CREATE TABLE `bookmarks` (
	`title` text PRIMARY KEY NOT NULL
);
--> statement-breakpoint
CREATE TABLE `notes` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `pages` (
	`title` text PRIMARY KEY NOT NULL,
	`content` text NOT NULL,
	`version` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`summary` text NOT NULL,
	`created_at` text NOT NULL,
	`size` integer NOT NULL
);
