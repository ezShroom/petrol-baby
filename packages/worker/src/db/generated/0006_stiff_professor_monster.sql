PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_station_opening_time` (
	`nodeId` text NOT NULL,
	`day` integer NOT NULL,
	`openTime` text NOT NULL,
	`closeTime` text NOT NULL,
	`is24Hours` integer NOT NULL,
	PRIMARY KEY(`nodeId`, `day`),
	FOREIGN KEY (`nodeId`) REFERENCES `fuel_station`(`nodeId`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_station_opening_time`("nodeId", "day", "openTime", "closeTime", "is24Hours") SELECT "nodeId", "day", "openTime", "closeTime", "is24Hours" FROM `station_opening_time`;--> statement-breakpoint
DROP TABLE `station_opening_time`;--> statement-breakpoint
ALTER TABLE `__new_station_opening_time` RENAME TO `station_opening_time`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_station_amenity` (
	`nodeId` text NOT NULL,
	`amenityCode` text NOT NULL,
	PRIMARY KEY(`nodeId`, `amenityCode`),
	FOREIGN KEY (`nodeId`) REFERENCES `fuel_station`(`nodeId`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`amenityCode`) REFERENCES `known_amenity`(`amenityCode`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_station_amenity`("nodeId", "amenityCode") SELECT "nodeId", "amenityCode" FROM `station_amenity`;--> statement-breakpoint
DROP TABLE `station_amenity`;--> statement-breakpoint
ALTER TABLE `__new_station_amenity` RENAME TO `station_amenity`;