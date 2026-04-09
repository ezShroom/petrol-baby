PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_data_metadata` (
	`region` integer PRIMARY KEY NOT NULL,
	`backfilledAt` integer NOT NULL,
	`lastUpdatedAt` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_data_metadata`("region", "backfilledAt", "lastUpdatedAt") SELECT "region", "backfilledAt", "lastUpdatedAt" FROM `data_metadata`;--> statement-breakpoint
DROP TABLE `data_metadata`;--> statement-breakpoint
ALTER TABLE `__new_data_metadata` RENAME TO `data_metadata`;--> statement-breakpoint
PRAGMA foreign_keys=ON;