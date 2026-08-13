CREATE TABLE `pinResetTokens` (
	`id` int AUTO_INCREMENT NOT NULL,
	`token` varchar(128) NOT NULL,
	`userId` int NOT NULL,
	`expiresAt` timestamp NOT NULL,
	`used` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `pinResetTokens_id` PRIMARY KEY(`id`),
	CONSTRAINT `pinResetTokens_token_unique` UNIQUE(`token`)
);
--> statement-breakpoint
ALTER TABLE `matches` ADD `scorePlayer` int;--> statement-breakpoint
ALTER TABLE `matches` ADD `scoreOpponent` int;--> statement-breakpoint
ALTER TABLE `users` ADD `failedLoginAttempts` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `lockedUntil` timestamp;--> statement-breakpoint
CREATE INDEX `token_idx` ON `pinResetTokens` (`token`);--> statement-breakpoint
CREATE INDEX `userId_idx` ON `pinResetTokens` (`userId`);--> statement-breakpoint
CREATE INDEX `user_played_idx` ON `matches` (`userId`,`playedAt`);--> statement-breakpoint
CREATE INDEX `user_idx` ON `matches` (`userId`);--> statement-breakpoint
CREATE INDEX `email_idx` ON `users` (`email`);