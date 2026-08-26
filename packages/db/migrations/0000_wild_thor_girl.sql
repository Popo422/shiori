CREATE TABLE `beats` (
	`id` text PRIMARY KEY NOT NULL,
	`book_id` text NOT NULL,
	`spine_index` integer NOT NULL,
	`para_index` integer NOT NULL,
	`kind` text NOT NULL,
	`prompt` text NOT NULL,
	`character_ids` text NOT NULL,
	`salience` real DEFAULT 0.5 NOT NULL,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `beats_by_position` ON `beats` (`book_id`,`spine_index`,`para_index`);--> statement-breakpoint
CREATE TABLE `books` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`author` text,
	`format` text NOT NULL,
	`spine_count` integer DEFAULT 0 NOT NULL,
	`analyzed_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `characters` (
	`id` text PRIMARY KEY NOT NULL,
	`book_id` text NOT NULL,
	`name` text NOT NULL,
	`descriptor` text NOT NULL,
	`reference_key` text,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `illustrations` (
	`beat_id` text NOT NULL,
	`style_id` text NOT NULL,
	`book_id` text NOT NULL,
	`status` text NOT NULL,
	`key` text,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`error` text,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`beat_id`, `style_id`),
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `art_by_book` ON `illustrations` (`book_id`,`status`);