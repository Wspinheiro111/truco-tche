CREATE TABLE `scheduledJobs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(80) NOT NULL,
	`taskUid` varchar(65) NOT NULL,
	`cronExpression` varchar(64) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `scheduledJobs_id` PRIMARY KEY(`id`),
	CONSTRAINT `scheduled_job_name_unique_idx` UNIQUE(`name`),
	CONSTRAINT `scheduled_job_task_uid_unique_idx` UNIQUE(`taskUid`)
);
