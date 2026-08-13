ALTER TABLE `users` ADD `googleLinked` boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE `sponsors` ADD `dailyImpressionGoal` int NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `sponsors` ADD `startDate` date;
