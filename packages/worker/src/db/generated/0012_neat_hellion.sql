ALTER TABLE `fuel_station` ADD `slug` text;--> statement-breakpoint
CREATE UNIQUE INDEX `fuel_station_slug_idx` ON `fuel_station` (`slug`);--> statement-breakpoint
CREATE INDEX `fuel_station_lat_lng_idx` ON `fuel_station` (`latitude`,`longitude`);