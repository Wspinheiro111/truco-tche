ALTER TABLE `sponsors` MODIFY COLUMN `startDate` date;--> statement-breakpoint
ALTER TABLE `sponsors` MODIFY COLUMN `endDate` date;--> statement-breakpoint
ALTER TABLE `userPurchases` MODIFY COLUMN `transactionId` int;--> statement-breakpoint
ALTER TABLE `users` MODIFY COLUMN `lastSignedIn` timestamp;--> statement-breakpoint
ALTER TABLE `userPurchases` ADD CONSTRAINT `userPurchases_transactionId_pilasTransactions_id_fk` FOREIGN KEY (`transactionId`) REFERENCES `pilasTransactions`(`id`) ON DELETE set null ON UPDATE no action;