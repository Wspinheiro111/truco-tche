CREATE TABLE `onlineMatches` (
	`id` int AUTO_INCREMENT NOT NULL,
	`roomCode` varchar(10) NOT NULL,
	`player1Id` int NOT NULL,
	`player1Name` varchar(100) NOT NULL,
	`player2Id` int NOT NULL,
	`player2Name` varchar(100) NOT NULL,
	`winnerId` int NOT NULL,
	`scoreP1` int NOT NULL,
	`scoreP2` int NOT NULL,
	`mode` varchar(10) NOT NULL DEFAULT '1v1',
	`durationSeconds` int,
	`tournamentId` int,
	`isWalkover` int NOT NULL DEFAULT 0,
	`playedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `onlineMatches_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `onlineRooms` (
	`id` int AUTO_INCREMENT NOT NULL,
	`code` varchar(10) NOT NULL,
	`hostId` int NOT NULL,
	`hostName` varchar(100) NOT NULL,
	`guestId` int,
	`guestName` varchar(100),
	`mode` varchar(10) NOT NULL DEFAULT '1v1',
	`status` enum('waiting','playing','finished','abandoned') NOT NULL DEFAULT 'waiting',
	`tournamentId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `onlineRooms_id` PRIMARY KEY(`id`),
	CONSTRAINT `onlineRooms_code_unique` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `onlineTournamentPlayers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tournamentId` int NOT NULL,
	`userId` int NOT NULL,
	`userName` varchar(100) NOT NULL,
	`seed` int NOT NULL DEFAULT 0,
	`eliminated` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `onlineTournamentPlayers_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `onlineTournaments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`creatorId` int NOT NULL,
	`name` varchar(100) NOT NULL,
	`maxPlayers` int NOT NULL DEFAULT 8,
	`status` enum('registering','active','completed','cancelled') NOT NULL DEFAULT 'registering',
	`prize` varchar(200),
	`bracketData` text,
	`totalRounds` int NOT NULL,
	`currentRound` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`completedAt` timestamp,
	CONSTRAINT `onlineTournaments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `om_p1_idx` ON `onlineMatches` (`player1Id`);--> statement-breakpoint
CREATE INDEX `om_p2_idx` ON `onlineMatches` (`player2Id`);--> statement-breakpoint
CREATE INDEX `om_winner_idx` ON `onlineMatches` (`winnerId`);--> statement-breakpoint
CREATE INDEX `om_tournament_idx` ON `onlineMatches` (`tournamentId`);--> statement-breakpoint
CREATE INDEX `room_code_idx` ON `onlineRooms` (`code`);--> statement-breakpoint
CREATE INDEX `room_status_idx` ON `onlineRooms` (`status`);--> statement-breakpoint
CREATE INDEX `room_host_idx` ON `onlineRooms` (`hostId`);--> statement-breakpoint
CREATE INDEX `otp_tournament_idx` ON `onlineTournamentPlayers` (`tournamentId`);--> statement-breakpoint
CREATE INDEX `otp_user_idx` ON `onlineTournamentPlayers` (`userId`);--> statement-breakpoint
CREATE INDEX `otp_unique_idx` ON `onlineTournamentPlayers` (`tournamentId`,`userId`);--> statement-breakpoint
CREATE INDEX `ot_status_idx` ON `onlineTournaments` (`status`);--> statement-breakpoint
CREATE INDEX `ot_creator_idx` ON `onlineTournaments` (`creatorId`);