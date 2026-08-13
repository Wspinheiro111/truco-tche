CREATE TABLE `pilasBalance` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`balance` int NOT NULL DEFAULT 0,
	`totalPurchased` int NOT NULL DEFAULT 0,
	`totalSpent` int NOT NULL DEFAULT 0,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `pilasBalance_id` PRIMARY KEY(`id`),
	CONSTRAINT `pilasBalance_userId_unique` UNIQUE(`userId`)
);
--> statement-breakpoint
CREATE TABLE `pilasPackages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(100) NOT NULL,
	`pilas` int NOT NULL,
	`priceCents` int NOT NULL,
	`bonusPilas` int NOT NULL DEFAULT 0,
	`active` int NOT NULL DEFAULT 1,
	`displayOrder` int NOT NULL DEFAULT 0,
	`badge` varchar(50),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `pilasPackages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `pilasTransactions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`type` enum('purchase','spend','reward','refund') NOT NULL,
	`amount` int NOT NULL,
	`description` varchar(255) NOT NULL,
	`referenceId` varchar(255),
	`balanceAfter` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `pilasTransactions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `pixPayments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`packageId` int NOT NULL,
	`mpPaymentId` varchar(64) NOT NULL,
	`status` enum('pending','approved','rejected','cancelled','refunded') NOT NULL DEFAULT 'pending',
	`amountCents` int NOT NULL,
	`pilasToCredit` int NOT NULL,
	`credited` int NOT NULL DEFAULT 0,
	`qrCode` text,
	`qrCodeBase64` text,
	`ticketUrl` text,
	`expiresAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `pixPayments_id` PRIMARY KEY(`id`),
	CONSTRAINT `pixPayments_mpPaymentId_unique` UNIQUE(`mpPaymentId`)
);
--> statement-breakpoint
CREATE INDEX `pb_user_idx` ON `pilasBalance` (`userId`);--> statement-breakpoint
CREATE INDEX `pp_active_idx` ON `pilasPackages` (`active`);--> statement-breakpoint
CREATE INDEX `pp_order_idx` ON `pilasPackages` (`displayOrder`);--> statement-breakpoint
CREATE INDEX `pt_user_idx` ON `pilasTransactions` (`userId`);--> statement-breakpoint
CREATE INDEX `pt_type_idx` ON `pilasTransactions` (`type`);--> statement-breakpoint
CREATE INDEX `pt_ref_idx` ON `pilasTransactions` (`referenceId`);--> statement-breakpoint
CREATE INDEX `pxp_user_idx` ON `pixPayments` (`userId`);--> statement-breakpoint
CREATE INDEX `pxp_mp_idx` ON `pixPayments` (`mpPaymentId`);--> statement-breakpoint
CREATE INDEX `pxp_status_idx` ON `pixPayments` (`status`);