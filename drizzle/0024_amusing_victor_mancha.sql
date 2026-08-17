CREATE TABLE `activeOnlineGamePlayers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`roomCode` varchar(10) NOT NULL,
	`userId` int NOT NULL,
	`userName` varchar(100) NOT NULL,
	`seat` int NOT NULL,
	`team` enum('A','B') NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `activeOnlineGamePlayers_id` PRIMARY KEY(`id`),
	CONSTRAINT `aogp_room_seat_unique_idx` UNIQUE(`roomCode`,`seat`),
	CONSTRAINT `aogp_room_user_unique_idx` UNIQUE(`roomCode`,`userId`)
);
--> statement-breakpoint
CREATE TABLE `inPersonTablePlayers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tableId` int NOT NULL,
	`userId` int NOT NULL,
	`userName` varchar(100) NOT NULL,
	`seat` int NOT NULL,
	`team` enum('A','B') NOT NULL,
	`joinedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `inPersonTablePlayers_id` PRIMARY KEY(`id`),
	CONSTRAINT `iptp_table_seat_unique_idx` UNIQUE(`tableId`,`seat`),
	CONSTRAINT `iptp_table_user_unique_idx` UNIQUE(`tableId`,`userId`)
);
--> statement-breakpoint
ALTER TABLE `inPersonTables` ADD `mode` enum('1v1','2v2','3v3') DEFAULT '1v1' NOT NULL;--> statement-breakpoint
ALTER TABLE `inPersonTables` ADD `maxPlayers` int DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE `activeOnlineGamePlayers` ADD CONSTRAINT `activeOnlineGamePlayers_roomCode_activeOnlineGames_roomCode_fk` FOREIGN KEY (`roomCode`) REFERENCES `activeOnlineGames`(`roomCode`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `activeOnlineGamePlayers` ADD CONSTRAINT `activeOnlineGamePlayers_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `inPersonTablePlayers` ADD CONSTRAINT `inPersonTablePlayers_tableId_inPersonTables_id_fk` FOREIGN KEY (`tableId`) REFERENCES `inPersonTables`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `inPersonTablePlayers` ADD CONSTRAINT `inPersonTablePlayers_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `aogp_user_idx` ON `activeOnlineGamePlayers` (`userId`);--> statement-breakpoint
CREATE INDEX `iptp_user_idx` ON `inPersonTablePlayers` (`userId`);