CREATE TABLE `userPurchases` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`category` varchar(20) NOT NULL,
	`itemId` varchar(50) NOT NULL,
	`pricePilas` int NOT NULL,
	`transactionId` varchar(100),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `userPurchases_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `user_purchases_user_idx` ON `userPurchases` (`userId`);--> statement-breakpoint
CREATE INDEX `user_purchases_unique_idx` ON `userPurchases` (`userId`,`category`,`itemId`);