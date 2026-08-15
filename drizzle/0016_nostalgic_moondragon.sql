CREATE TABLE `friendGameInvites` (
	`id` int AUTO_INCREMENT NOT NULL,
	`senderId` int NOT NULL,
	`receiverId` int NOT NULL,
	`roomCode` varchar(10) NOT NULL,
	`status` enum('pending','accepted','declined','cancelled','expired') NOT NULL DEFAULT 'pending',
	`expiresAt` timestamp NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`respondedAt` timestamp,
	CONSTRAINT `friendGameInvites_id` PRIMARY KEY(`id`),
	CONSTRAINT `invite_sender_room_unique_idx` UNIQUE(`senderId`,`roomCode`)
);
--> statement-breakpoint
CREATE TABLE `friendships` (
	`id` int AUTO_INCREMENT NOT NULL,
	`requesterId` int NOT NULL,
	`addresseeId` int NOT NULL,
	`status` enum('pending','accepted','declined') NOT NULL DEFAULT 'pending',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`respondedAt` timestamp,
	CONSTRAINT `friendships_id` PRIMARY KEY(`id`),
	CONSTRAINT `friend_direction_unique_idx` UNIQUE(`requesterId`,`addresseeId`)
);
--> statement-breakpoint
ALTER TABLE `onlineRooms` ADD `isPrivate` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `onlineRooms` ADD `privateInviteeId` int;--> statement-breakpoint
ALTER TABLE `friendGameInvites` ADD CONSTRAINT `friendGameInvites_senderId_users_id_fk` FOREIGN KEY (`senderId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `friendGameInvites` ADD CONSTRAINT `friendGameInvites_receiverId_users_id_fk` FOREIGN KEY (`receiverId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `friendGameInvites` ADD CONSTRAINT `friendGameInvites_roomCode_onlineRooms_code_fk` FOREIGN KEY (`roomCode`) REFERENCES `onlineRooms`(`code`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `friendships` ADD CONSTRAINT `friendships_requesterId_users_id_fk` FOREIGN KEY (`requesterId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `friendships` ADD CONSTRAINT `friendships_addresseeId_users_id_fk` FOREIGN KEY (`addresseeId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `invite_receiver_idx` ON `friendGameInvites` (`receiverId`,`status`);--> statement-breakpoint
CREATE INDEX `invite_room_idx` ON `friendGameInvites` (`roomCode`);--> statement-breakpoint
CREATE INDEX `friend_requester_idx` ON `friendships` (`requesterId`,`status`);--> statement-breakpoint
CREATE INDEX `friend_addressee_idx` ON `friendships` (`addresseeId`,`status`);--> statement-breakpoint
ALTER TABLE `onlineRooms` ADD CONSTRAINT `onlineRooms_privateInviteeId_users_id_fk` FOREIGN KEY (`privateInviteeId`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `room_private_invitee_idx` ON `onlineRooms` (`privateInviteeId`,`status`);