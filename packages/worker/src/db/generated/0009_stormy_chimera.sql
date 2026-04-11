PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_pricing_event` (
	`nodeId` text,
	`typeCode` text NOT NULL,
	`timestamp` integer NOT NULL,
	`pricePence` real NOT NULL,
	PRIMARY KEY(`nodeId`, `typeCode`, `timestamp`),
	FOREIGN KEY (`nodeId`) REFERENCES `fuel_station`(`nodeId`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`typeCode`) REFERENCES `known_type`(`typeCode`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_pricing_event`("nodeId", "typeCode", "timestamp", "pricePence") SELECT "nodeId", "typeCode", "timestamp", "pricePence" FROM `pricing_event`;--> statement-breakpoint
DROP TABLE `pricing_event`;--> statement-breakpoint
ALTER TABLE `__new_pricing_event` RENAME TO `pricing_event`;--> statement-breakpoint
PRAGMA foreign_keys=ON;