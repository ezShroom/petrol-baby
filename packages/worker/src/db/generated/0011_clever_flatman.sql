CREATE INDEX `fuel_station_postcode_idx` ON `fuel_station` (`postcode`);--> statement-breakpoint
CREATE INDEX `fuel_station_country_idx` ON `fuel_station` (`country`);--> statement-breakpoint
CREATE INDEX `fuel_station_city_idx` ON `fuel_station` (`city`);--> statement-breakpoint
CREATE INDEX `fuel_station_brand_name_idx` ON `fuel_station` (`brandName`);--> statement-breakpoint
CREATE INDEX `pricing_event_type_code_timestamp_idx` ON `pricing_event` (`typeCode`,`timestamp`);