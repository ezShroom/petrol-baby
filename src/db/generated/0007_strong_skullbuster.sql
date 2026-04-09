PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_available_fuel_type` (
	`nodeId` text NOT NULL,
	`typeCode` text NOT NULL,
	PRIMARY KEY(`nodeId`, `typeCode`),
	FOREIGN KEY (`nodeId`) REFERENCES `fuel_station`(`nodeId`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`typeCode`) REFERENCES `known_type`(`typeCode`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_available_fuel_type`("nodeId", "typeCode") SELECT "nodeId", "typeCode" FROM `available_fuel_type`;--> statement-breakpoint
DROP TABLE `available_fuel_type`;--> statement-breakpoint
ALTER TABLE `__new_available_fuel_type` RENAME TO `available_fuel_type`;--> statement-breakpoint
PRAGMA foreign_keys=ON;