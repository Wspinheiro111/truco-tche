CREATE TABLE `tournamentMatches` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tournamentId` int NOT NULL,
	`userId` int NOT NULL,
	`roundIndex` int NOT NULL,
	`matchIndex` int NOT NULL DEFAULT 0,
	`result` enum('win','lose') NOT NULL,
	`score` varchar(20) NOT NULL,
	`scorePlayer` int,
	`scoreOpponent` int,
	`opponentName` varchar(100),
	`opponentAvatar` varchar(10),
	`durationSeconds` int,
	`playedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `tournamentMatches_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `tournaments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`name` varchar(100) NOT NULL,
	`type` enum('ai','bracket') NOT NULL DEFAULT 'ai',
	`status` enum('active','completed','abandoned') NOT NULL DEFAULT 'active',
	`totalRounds` int NOT NULL,
	`currentRound` int NOT NULL DEFAULT 0,
	`wins` int NOT NULL DEFAULT 0,
	`losses` int NOT NULL DEFAULT 0,
	`prizeCoins` int NOT NULL DEFAULT 0,
	`coinsAwarded` int,
	`opponentIds` text,
	`bracketData` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`completedAt` timestamp,
	CONSTRAINT `tournaments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `tm_tournament_idx` ON `tournamentMatches` (`tournamentId`);--> statement-breakpoint
CREATE INDEX `tm_user_idx` ON `tournamentMatches` (`userId`);--> statement-breakpoint
CREATE INDEX `tm_round_idx` ON `tournamentMatches` (`tournamentId`,`roundIndex`);--> statement-breakpoint
CREATE INDEX `tournament_user_idx` ON `tournaments` (`userId`);--> statement-breakpoint
CREATE INDEX `tournament_status_idx` ON `tournaments` (`status`);