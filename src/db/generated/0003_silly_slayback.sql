CREATE TABLE `data_metadata` (
	`region` integer PRIMARY KEY NOT NULL,
	`backfilledAt` integer NOT NULL,
	`lastUpdatedAt` integer
);
--> statement-breakpoint
DROP TABLE `flag`;