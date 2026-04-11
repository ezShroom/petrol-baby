ALTER TABLE `keys` RENAME TO `key`;--> statement-breakpoint
CREATE TABLE `available_fuel_type` (
	`associationId` text PRIMARY KEY NOT NULL,
	`nodeId` text NOT NULL,
	`typeCode` text NOT NULL,
	FOREIGN KEY (`nodeId`) REFERENCES `fuel_station`(`nodeId`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`typeCode`) REFERENCES `known_type`(`typeCode`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `fuel_station` (
	`nodeId` text PRIMARY KEY NOT NULL,
	`phone` text,
	`tradingName` text,
	`brandName` text,
	`matchingNames` integer,
	`temporarilyClosed` integer,
	`permanentlyClosed` integer,
	`isMotorwayService` integer,
	`isSupermarketService` integer,
	`address1` text,
	`address2` text,
	`city` text,
	`country` text,
	`county` text,
	`postcode` text,
	`latitude` real,
	`longitude` real
);
--> statement-breakpoint
CREATE TABLE `known_type` (
	`typeCode` text PRIMARY KEY NOT NULL
);
--> statement-breakpoint
CREATE TABLE `pricing_event` (
	`nodeId` text,
	`typeCode` text NOT NULL,
	`timestamp` integer NOT NULL,
	`pricePence` real NOT NULL,
	FOREIGN KEY (`nodeId`) REFERENCES `fuel_station`(`nodeId`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`typeCode`) REFERENCES `known_type`(`typeCode`) ON UPDATE no action ON DELETE no action
);
