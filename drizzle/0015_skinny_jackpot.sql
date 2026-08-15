CREATE TABLE `activeOnlineGames` (
	`id` int AUTO_INCREMENT NOT NULL,
	`roomCode` varchar(10) NOT NULL,
	`player1Id` int NOT NULL,
	`player1Name` varchar(100) NOT NULL,
	`player2Id` int NOT NULL,
	`player2Name` varchar(100) NOT NULL,
	`stateJson` text NOT NULL,
	`version` int NOT NULL DEFAULT 1,
	`status` enum('active','finished','abandoned') NOT NULL DEFAULT 'active',
	`turnDeadline` timestamp,
	`lastEventId` varchar(64),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `activeOnlineGames_id` PRIMARY KEY(`id`),
	CONSTRAINT `activeOnlineGames_roomCode_unique` UNIQUE(`roomCode`)
);
--> statement-breakpoint
ALTER TABLE `activeOnlineGames` ADD CONSTRAINT `activeOnlineGames_player1Id_users_id_fk` FOREIGN KEY (`player1Id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `activeOnlineGames` ADD CONSTRAINT `activeOnlineGames_player2Id_users_id_fk` FOREIGN KEY (`player2Id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `aog_room_idx` ON `activeOnlineGames` (`roomCode`);--> statement-breakpoint
CREATE INDEX `aog_p1_idx` ON `activeOnlineGames` (`player1Id`);--> statement-breakpoint
CREATE INDEX `aog_p2_idx` ON `activeOnlineGames` (`player2Id`);--> statement-breakpoint
CREATE INDEX `aog_status_idx` ON `activeOnlineGames` (`status`);