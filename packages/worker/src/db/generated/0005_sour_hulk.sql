CREATE TABLE `known_amenity` (
	`amenityCode` text PRIMARY KEY NOT NULL
);
--> statement-breakpoint
CREATE TABLE `potential_duplicate` (
	`sourceNodeId` text NOT NULL,
	`targetNodeId` text NOT NULL,
	PRIMARY KEY(`sourceNodeId`, `targetNodeId`),
	FOREIGN KEY (`sourceNodeId`) REFERENCES `fuel_station`(`nodeId`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`targetNodeId`) REFERENCES `fuel_station`(`nodeId`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `station_amenity` (
	`associationId` text PRIMARY KEY NOT NULL,
	`nodeId` text NOT NULL,
	`amenityCode` text NOT NULL,
	FOREIGN KEY (`nodeId`) REFERENCES `fuel_station`(`nodeId`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`amenityCode`) REFERENCES `known_amenity`(`amenityCode`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `station_opening_time` (
	`nodeId` text NOT NULL,
	`day` text NOT NULL,
	`openTime` text NOT NULL,
	`closeTime` text NOT NULL,
	`is24Hours` integer NOT NULL,
	`bankHolidayType` text,
	PRIMARY KEY(`nodeId`, `day`),
	FOREIGN KEY (`nodeId`) REFERENCES `fuel_station`(`nodeId`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `fuel_station` ADD `permanentClosureDate` text;--> statement-breakpoint
ALTER TABLE `fuel_station` ADD `coordinatesValid` integer;--> statement-breakpoint
ALTER TABLE `fuel_station` ADD `sourceHash` text;--> statement-breakpoint
ALTER TABLE `fuel_station` DROP COLUMN `county`;