CREATE TABLE `settings` (
	`id` text PRIMARY KEY NOT NULL,
	`book_id` text NOT NULL,
	`name` text NOT NULL,
	`descriptor` text NOT NULL,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `beats` ADD `setting_id` text;