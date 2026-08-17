CREATE TABLE `inPersonTables` (
	`id` int AUTO_INCREMENT NOT NULL,
	`roomCode` varchar(10) NOT NULL,
	`hostId` int NOT NULL,
	`guestId` int,
	`inviteTokenHash` varchar(64) NOT NULL,
	`status` enum('waiting','playing','expired','cancelled') NOT NULL DEFAULT 'waiting',
	`expiresAt` timestamp NOT NULL,
	`joinedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `inPersonTables_id` PRIMARY KEY(`id`),
	CONSTRAINT `inPersonTables_roomCode_unique` UNIQUE(`roomCode`)
);
--> statement-breakpoint
CREATE TABLE `userNotifications` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`kind` enum('tournament_reminder','in_person_table') NOT NULL,
	`title` varchar(180) NOT NULL,
	`body` varchar(500) NOT NULL,
	`targetUrl` varchar(500),
	`metadataJson` text,
	`readAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `userNotifications_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `inPersonTables` ADD CONSTRAINT `inPersonTables_roomCode_onlineRooms_code_fk` FOREIGN KEY (`roomCode`) REFERENCES `onlineRooms`(`code`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `inPersonTables` ADD CONSTRAINT `inPersonTables_hostId_users_id_fk` FOREIGN KEY (`hostId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `inPersonTables` ADD CONSTRAINT `inPersonTables_guestId_users_id_fk` FOREIGN KEY (`guestId`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `userNotifications` ADD CONSTRAINT `userNotifications_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `in_person_host_status_idx` ON `inPersonTables` (`hostId`,`status`);--> statement-breakpoint
CREATE INDEX `in_person_expiry_idx` ON `inPersonTables` (`status`,`expiresAt`);--> statement-breakpoint
CREATE INDEX `notification_user_created_idx` ON `userNotifications` (`userId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `notification_user_unread_idx` ON `userNotifications` (`userId`,`readAt`);