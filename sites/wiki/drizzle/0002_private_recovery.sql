CREATE TABLE `comments` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`number` integer NOT NULL,
	`body` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "comment_number" CHECK("comments"."number" BETWEEN 1 AND 1000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `comment_thread_number` ON `comments` (`thread_id`,`number`);--> statement-breakpoint
CREATE TABLE `mutation_guards` (
	`id` text PRIMARY KEY NOT NULL,
	`valid` integer NOT NULL,
	CONSTRAINT "guard_valid" CHECK("mutation_guards"."valid"=1)
);
--> statement-breakpoint
CREATE TABLE `restore_stage` (
	`title` text PRIMARY KEY NOT NULL,
	`content` text NOT NULL,
	`version` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text NOT NULL,
	`delete_summary` text NOT NULL,
	`trash_id` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `threads` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`subject` text NOT NULL,
	`status` text NOT NULL,
	`version` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "thread_status" CHECK("threads"."status" IN ('open','paused','closed'))
);
--> statement-breakpoint
CREATE INDEX `threads_title` ON `threads` (`title`,`updated_at`);--> statement-breakpoint
CREATE TABLE `trash` (
	`title` text PRIMARY KEY NOT NULL,
	`content` text NOT NULL,
	`version` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text NOT NULL,
	`delete_summary` text NOT NULL,
	`trash_id` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trash_trash_id_unique` ON `trash` (`trash_id`);--> statement-breakpoint
CREATE TABLE `wiki_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`version` integer NOT NULL,
	CONSTRAINT "state_singleton" CHECK("wiki_state"."id"=1)
);

--> statement-breakpoint
INSERT INTO wiki_state VALUES(1,0);
--> statement-breakpoint
CREATE TRIGGER reserve_trash_title BEFORE INSERT ON pages WHEN EXISTS(SELECT 1 FROM trash WHERE title=NEW.title) BEGIN SELECT RAISE(IGNORE); END;
--> statement-breakpoint
CREATE TRIGGER reserve_trash_update BEFORE UPDATE OF title ON pages WHEN EXISTS(SELECT 1 FROM trash WHERE title=NEW.title) BEGIN SELECT RAISE(ABORT,'reserved trash title'); END;
--> statement-breakpoint
CREATE TRIGGER state_pages_insert AFTER INSERT ON pages BEGIN UPDATE wiki_state SET version=version+1 WHERE id=1; END;
--> statement-breakpoint
CREATE TRIGGER state_pages_update AFTER UPDATE ON pages BEGIN UPDATE wiki_state SET version=version+1 WHERE id=1; END;
--> statement-breakpoint
CREATE TRIGGER state_pages_delete AFTER DELETE ON pages BEGIN UPDATE wiki_state SET version=version+1 WHERE id=1; END;
--> statement-breakpoint
CREATE TRIGGER state_revisions_insert AFTER INSERT ON revisions BEGIN UPDATE wiki_state SET version=version+1 WHERE id=1; END;
--> statement-breakpoint
CREATE TRIGGER state_revisions_update AFTER UPDATE ON revisions BEGIN UPDATE wiki_state SET version=version+1 WHERE id=1; END;
--> statement-breakpoint
CREATE TRIGGER state_revisions_delete AFTER DELETE ON revisions BEGIN UPDATE wiki_state SET version=version+1 WHERE id=1; END;
--> statement-breakpoint
CREATE TRIGGER state_notes_insert AFTER INSERT ON notes BEGIN UPDATE wiki_state SET version=version+1 WHERE id=1; END;
--> statement-breakpoint
CREATE TRIGGER state_notes_update AFTER UPDATE ON notes BEGIN UPDATE wiki_state SET version=version+1 WHERE id=1; END;
--> statement-breakpoint
CREATE TRIGGER state_notes_delete AFTER DELETE ON notes BEGIN UPDATE wiki_state SET version=version+1 WHERE id=1; END;
--> statement-breakpoint
CREATE TRIGGER state_bookmarks_insert AFTER INSERT ON bookmarks BEGIN UPDATE wiki_state SET version=version+1 WHERE id=1; END;
--> statement-breakpoint
CREATE TRIGGER state_bookmarks_update AFTER UPDATE ON bookmarks BEGIN UPDATE wiki_state SET version=version+1 WHERE id=1; END;
--> statement-breakpoint
CREATE TRIGGER state_bookmarks_delete AFTER DELETE ON bookmarks BEGIN UPDATE wiki_state SET version=version+1 WHERE id=1; END;
--> statement-breakpoint
CREATE TRIGGER state_attachments_insert AFTER INSERT ON attachments BEGIN UPDATE wiki_state SET version=version+1 WHERE id=1; END;
--> statement-breakpoint
CREATE TRIGGER state_attachments_update AFTER UPDATE ON attachments BEGIN UPDATE wiki_state SET version=version+1 WHERE id=1; END;
--> statement-breakpoint
CREATE TRIGGER state_attachments_delete AFTER DELETE ON attachments BEGIN UPDATE wiki_state SET version=version+1 WHERE id=1; END;
--> statement-breakpoint
CREATE TRIGGER state_trash_insert AFTER INSERT ON trash BEGIN UPDATE wiki_state SET version=version+1 WHERE id=1; END;
--> statement-breakpoint
CREATE TRIGGER state_trash_update AFTER UPDATE ON trash BEGIN UPDATE wiki_state SET version=version+1 WHERE id=1; END;
--> statement-breakpoint
CREATE TRIGGER state_trash_delete AFTER DELETE ON trash BEGIN UPDATE wiki_state SET version=version+1 WHERE id=1; END;
--> statement-breakpoint
CREATE TRIGGER state_threads_insert AFTER INSERT ON threads BEGIN UPDATE wiki_state SET version=version+1 WHERE id=1; END;
--> statement-breakpoint
CREATE TRIGGER state_threads_update AFTER UPDATE ON threads BEGIN UPDATE wiki_state SET version=version+1 WHERE id=1; END;
--> statement-breakpoint
CREATE TRIGGER state_threads_delete AFTER DELETE ON threads BEGIN UPDATE wiki_state SET version=version+1 WHERE id=1; END;
--> statement-breakpoint
CREATE TRIGGER state_comments_insert AFTER INSERT ON comments BEGIN UPDATE wiki_state SET version=version+1 WHERE id=1; END;
--> statement-breakpoint
CREATE TRIGGER state_comments_update AFTER UPDATE ON comments BEGIN UPDATE wiki_state SET version=version+1 WHERE id=1; END;
--> statement-breakpoint
CREATE TRIGGER state_comments_delete AFTER DELETE ON comments BEGIN UPDATE wiki_state SET version=version+1 WHERE id=1; END;
