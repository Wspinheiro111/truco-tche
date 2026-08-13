ALTER TABLE `onlineRooms` ADD `stakeTier` varchar(16) DEFAULT 'amistoso' NOT NULL;--> statement-breakpoint
ALTER TABLE `onlineRooms` ADD `region` varchar(8) DEFAULT 'BR' NOT NULL;--> statement-breakpoint
CREATE INDEX `room_filters_idx` ON `onlineRooms` (`mode`,`stakeTier`,`region`);
