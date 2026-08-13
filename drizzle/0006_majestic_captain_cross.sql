CREATE TABLE `sponsorEvents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`sponsorId` int NOT NULL,
	`eventType` enum('impression','click') NOT NULL,
	`eventDate` varchar(10) NOT NULL,
	`count` int NOT NULL DEFAULT 1,
	CONSTRAINT `sponsorEvents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `se_sponsor_idx` ON `sponsorEvents` (`sponsorId`);--> statement-breakpoint
CREATE INDEX `se_date_idx` ON `sponsorEvents` (`eventDate`);--> statement-breakpoint
CREATE INDEX `se_unique_idx` ON `sponsorEvents` (`sponsorId`,`eventType`,`eventDate`);