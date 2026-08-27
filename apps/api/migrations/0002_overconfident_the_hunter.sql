CREATE TABLE `character_appearances` (
	`id` text PRIMARY KEY NOT NULL,
	`character_id` text NOT NULL,
	`book_id` text NOT NULL,
	`from_spine_index` integer NOT NULL,
	`descriptor` text NOT NULL,
	`reference_key` text,
	FOREIGN KEY (`character_id`) REFERENCES `characters`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `appearance_by_character` ON `character_appearances` (`character_id`,`from_spine_index`);--> statement-breakpoint
ALTER TABLE `characters` DROP COLUMN `descriptor`;--> statement-breakpoint
ALTER TABLE `characters` DROP COLUMN `reference_key`;