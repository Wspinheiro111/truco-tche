CREATE TABLE `pushSubscriptions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`endpoint` text NOT NULL,
	`endpointHash` varchar(64) NOT NULL,
	`p256dh` varchar(512) NOT NULL,
	`auth` varchar(512) NOT NULL,
	`userAgent` varchar(512),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `pushSubscriptions_id` PRIMARY KEY(`id`),
	CONSTRAINT `push_subscription_endpoint_unique_idx` UNIQUE(`endpointHash`)
);
--> statement-breakpoint
CREATE TABLE `tournamentPushDeliveries` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tournamentId` int NOT NULL,
	`userId` int NOT NULL,
	`subscriptionId` int NOT NULL,
	`reminderKind` enum('one_hour','fifteen_minutes') NOT NULL,
	`deliveredAt` timestamp NOT NULL DEFAULT (now()),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `tournamentPushDeliveries_id` PRIMARY KEY(`id`),
	CONSTRAINT `tpd_subscription_reminder_unique_idx` UNIQUE(`tournamentId`,`subscriptionId`,`reminderKind`)
);
--> statement-breakpoint
ALTER TABLE `pushSubscriptions` ADD CONSTRAINT `pushSubscriptions_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tournamentPushDeliveries` ADD CONSTRAINT `tournamentPushDeliveries_tournamentId_onlineTournaments_id_fk` FOREIGN KEY (`tournamentId`) REFERENCES `onlineTournaments`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tournamentPushDeliveries` ADD CONSTRAINT `tournamentPushDeliveries_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tournamentPushDeliveries` ADD CONSTRAINT `tournamentPushDeliveries_subscriptionId_pushSubscriptions_id_fk` FOREIGN KEY (`subscriptionId`) REFERENCES `pushSubscriptions`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `push_subscription_user_idx` ON `pushSubscriptions` (`userId`);--> statement-breakpoint
CREATE INDEX `tpd_tournament_user_idx` ON `tournamentPushDeliveries` (`tournamentId`,`userId`);