CREATE TABLE `available_fuel_type` (
	`nodeId` text NOT NULL,
	`typeCode` text NOT NULL,
	PRIMARY KEY(`nodeId`, `typeCode`),
	FOREIGN KEY (`nodeId`) REFERENCES `fuel_station`(`nodeId`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`typeCode`) REFERENCES `known_type`(`typeCode`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `data_metadata` (
	`region` integer PRIMARY KEY NOT NULL,
	`backfilledAt` integer NOT NULL,
	`lastUpdatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `fuel_station` (
	`nodeId` text PRIMARY KEY NOT NULL,
	`phone` text,
	`tradingName` text,
	`brandName` text,
	`temporarilyClosed` integer,
	`isMotorwayService` integer,
	`isSupermarketService` integer,
	`address1` text,
	`address2` text,
	`city` text,
	`country` text,
	`postcode` text,
	`latitude` real,
	`longitude` real,
	`permanentClosureDate` text,
	`coordinatesValid` integer,
	`sourceHash` text,
	`slug` text
);
--> statement-breakpoint
CREATE INDEX `fuel_station_postcode_idx` ON `fuel_station` (`postcode`);--> statement-breakpoint
CREATE INDEX `fuel_station_country_idx` ON `fuel_station` (`country`);--> statement-breakpoint
CREATE INDEX `fuel_station_city_idx` ON `fuel_station` (`city`);--> statement-breakpoint
CREATE INDEX `fuel_station_brand_name_idx` ON `fuel_station` (`brandName`);--> statement-breakpoint
CREATE UNIQUE INDEX `fuel_station_slug_idx` ON `fuel_station` (`slug`);--> statement-breakpoint
CREATE INDEX `fuel_station_lat_lng_idx` ON `fuel_station` (`latitude`,`longitude`);--> statement-breakpoint
CREATE TABLE `key` (
	`type` integer PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`expires` integer
);
--> statement-breakpoint
CREATE TABLE `known_amenity` (
	`amenityCode` text PRIMARY KEY NOT NULL,
	`displayName` text
);
--> statement-breakpoint
CREATE TABLE `known_type` (
	`typeCode` text PRIMARY KEY NOT NULL
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
CREATE TABLE `pricing_event` (
	`nodeId` text,
	`typeCode` text NOT NULL,
	`timestamp` integer NOT NULL,
	`pricePence` real NOT NULL,
	PRIMARY KEY(`nodeId`, `typeCode`, `timestamp`),
	FOREIGN KEY (`nodeId`) REFERENCES `fuel_station`(`nodeId`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`typeCode`) REFERENCES `known_type`(`typeCode`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `pricing_event_type_code_node_id_timestamp_idx` ON `pricing_event` (`typeCode`,`nodeId`,`timestamp`);--> statement-breakpoint
CREATE TABLE `station_amenity` (
	`nodeId` text NOT NULL,
	`amenityCode` text NOT NULL,
	PRIMARY KEY(`nodeId`, `amenityCode`),
	FOREIGN KEY (`nodeId`) REFERENCES `fuel_station`(`nodeId`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`amenityCode`) REFERENCES `known_amenity`(`amenityCode`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `station_opening_time` (
	`nodeId` text NOT NULL,
	`day` integer NOT NULL,
	`openTime` text NOT NULL,
	`closeTime` text NOT NULL,
	`is24Hours` integer NOT NULL,
	PRIMARY KEY(`nodeId`, `day`),
	FOREIGN KEY (`nodeId`) REFERENCES `fuel_station`(`nodeId`) ON UPDATE cascade ON DELETE cascade
);
