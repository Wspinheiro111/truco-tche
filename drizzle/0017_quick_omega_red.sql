CREATE TABLE `rulesTestExecutions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`status` enum('passed','failed') NOT NULL,
	`passedChecks` int NOT NULL,
	`totalChecks` int NOT NULL,
	`failedChecksJson` text NOT NULL,
	`executedById` int,
	`executedByName` varchar(100),
	`ownerNotified` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `rulesTestExecutions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `rulesTestExecutions` ADD CONSTRAINT `rulesTestExecutions_executedById_users_id_fk` FOREIGN KEY (`executedById`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `rte_status_created_idx` ON `rulesTestExecutions` (`status`,`createdAt`);--> statement-breakpoint
CREATE INDEX `rte_created_idx` ON `rulesTestExecutions` (`createdAt`);