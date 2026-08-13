DROP INDEX `otp_unique_idx` ON `onlineTournamentPlayers`;--> statement-breakpoint
DROP INDEX `se_unique_idx` ON `sponsorEvents`;--> statement-breakpoint
DROP INDEX `user_purchases_unique_idx` ON `userPurchases`;--> statement-breakpoint
ALTER TABLE `onlineMatches` MODIFY COLUMN `isWalkover` boolean NOT NULL;--> statement-breakpoint
ALTER TABLE `onlineMatches` MODIFY COLUMN `isWalkover` boolean NOT NULL DEFAULT false;--> statement-breakpoint
ALTER TABLE `onlineTournamentPlayers` MODIFY COLUMN `eliminated` boolean NOT NULL;--> statement-breakpoint
ALTER TABLE `onlineTournamentPlayers` MODIFY COLUMN `eliminated` boolean NOT NULL DEFAULT false;--> statement-breakpoint
ALTER TABLE `pilasPackages` MODIFY COLUMN `active` boolean NOT NULL DEFAULT true;--> statement-breakpoint
ALTER TABLE `pinResetTokens` MODIFY COLUMN `used` boolean NOT NULL;--> statement-breakpoint
ALTER TABLE `pinResetTokens` MODIFY COLUMN `used` boolean NOT NULL DEFAULT false;--> statement-breakpoint
ALTER TABLE `pixPayments` MODIFY COLUMN `credited` boolean NOT NULL;--> statement-breakpoint
ALTER TABLE `pixPayments` MODIFY COLUMN `credited` boolean NOT NULL DEFAULT false;--> statement-breakpoint
ALTER TABLE `sponsors` MODIFY COLUMN `active` boolean NOT NULL DEFAULT true;--> statement-breakpoint
ALTER TABLE `onlineTournamentPlayers` ADD CONSTRAINT `otp_unique_idx` UNIQUE(`tournamentId`,`userId`);--> statement-breakpoint
ALTER TABLE `sponsorEvents` ADD CONSTRAINT `se_unique_idx` UNIQUE(`sponsorId`,`eventType`,`eventDate`);--> statement-breakpoint
ALTER TABLE `userPurchases` ADD CONSTRAINT `user_purchases_unique_idx` UNIQUE(`userId`,`category`,`itemId`);--> statement-breakpoint
ALTER TABLE `matches` ADD CONSTRAINT `matches_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `onlineMatches` ADD CONSTRAINT `onlineMatches_player1Id_users_id_fk` FOREIGN KEY (`player1Id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `onlineMatches` ADD CONSTRAINT `onlineMatches_player2Id_users_id_fk` FOREIGN KEY (`player2Id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `onlineMatches` ADD CONSTRAINT `onlineMatches_winnerId_users_id_fk` FOREIGN KEY (`winnerId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `onlineRooms` ADD CONSTRAINT `onlineRooms_hostId_users_id_fk` FOREIGN KEY (`hostId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `onlineRooms` ADD CONSTRAINT `onlineRooms_guestId_users_id_fk` FOREIGN KEY (`guestId`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `onlineTournamentPlayers` ADD CONSTRAINT `onlineTournamentPlayers_tournamentId_onlineTournaments_id_fk` FOREIGN KEY (`tournamentId`) REFERENCES `onlineTournaments`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `onlineTournamentPlayers` ADD CONSTRAINT `onlineTournamentPlayers_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `onlineTournaments` ADD CONSTRAINT `onlineTournaments_creatorId_users_id_fk` FOREIGN KEY (`creatorId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `pilasBalance` ADD CONSTRAINT `pilasBalance_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `pilasTransactions` ADD CONSTRAINT `pilasTransactions_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `pinResetTokens` ADD CONSTRAINT `pinResetTokens_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `pixPayments` ADD CONSTRAINT `pixPayments_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `pixPayments` ADD CONSTRAINT `pixPayments_packageId_pilasPackages_id_fk` FOREIGN KEY (`packageId`) REFERENCES `pilasPackages`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sponsorEvents` ADD CONSTRAINT `sponsorEvents_sponsorId_sponsors_id_fk` FOREIGN KEY (`sponsorId`) REFERENCES `sponsors`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tournamentMatches` ADD CONSTRAINT `tournamentMatches_tournamentId_tournaments_id_fk` FOREIGN KEY (`tournamentId`) REFERENCES `tournaments`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tournamentMatches` ADD CONSTRAINT `tournamentMatches_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tournaments` ADD CONSTRAINT `tournaments_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `userPurchases` ADD CONSTRAINT `userPurchases_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;