import {
  boolean,
  date,
  index,
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  phone: varchar("phone", { length: 20 }),
  state: varchar("state", { length: 2 }),
  city: varchar("city", { length: 100 }),
  pinHash: varchar("pinHash", { length: 255 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  googleLinked: boolean("googleLinked").default(false).notNull(),
  failedLoginAttempts: int("failedLoginAttempts").default(0).notNull(),
  lockedUntil: timestamp("lockedUntil"),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn"),
}, (table) => ({
  emailIdx: index("email_idx").on(table.email),
}));

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * Match history table
 */
export const matches = mysqlTable("matches", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  result: mysqlEnum("result", ["win", "lose"]).notNull(),
  score: varchar("score", { length: 20 }).notNull(),
  scorePlayer: int("scorePlayer"),
  scoreOpponent: int("scoreOpponent"),
  characterName: varchar("characterName", { length: 100 }),
  characterAvatar: varchar("characterAvatar", { length: 10 }),
  durationSeconds: int("durationSeconds"),
  playedAt: timestamp("playedAt").defaultNow().notNull(),
}, (table) => ({
  userPlayedIdx: index("user_played_idx").on(table.userId, table.playedAt),
  userIdx: index("user_idx").on(table.userId),
}));

export type Match = typeof matches.$inferSelect;
export type InsertMatch = typeof matches.$inferInsert;

/**
 * PIN reset tokens table
 */
export const pinResetTokens = mysqlTable("pinResetTokens", {
  id: int("id").autoincrement().primaryKey(),
  token: varchar("token", { length: 128 }).notNull().unique(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expiresAt").notNull(),
  used: boolean("used").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  tokenIdx: index("token_idx").on(table.token),
  userIdIdx: index("userId_idx").on(table.userId),
}));

export type PinResetToken = typeof pinResetTokens.$inferSelect;
export type InsertPinResetToken = typeof pinResetTokens.$inferInsert;

// ─── Tournament Tables ────────────────────────────────────────────────────────

/**
 * Tournaments table
 * Stores each tournament instance (vs AI characters or human bracket).
 *
 * type: 'ai' = Torneio dos Piquetes (player vs AI characters in sequence)
 *       'bracket' = Torneio Humano (bracket among multiple human players)
 *
 * status: 'active' | 'completed' | 'abandoned'
 *
 * bracketData: JSON blob storing the full bracket state for 'bracket' type tournaments.
 *   Shape: { players: Player[], rounds: Round[], currentRoundIdx: number }
 */
export const tournaments = mysqlTable("tournaments", {
  id: int("id").autoincrement().primaryKey(),
  /** Owner/creator of this tournament */
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  /** Display name of the tournament */
  name: varchar("name", { length: 100 }).notNull(),
  /** 'ai' = vs AI characters sequentially, 'bracket' = human bracket */
  type: mysqlEnum("type", ["ai", "bracket"]).notNull().default("ai"),
  /** Current status */
  status: mysqlEnum("status", ["active", "completed", "abandoned"]).notNull().default("active"),
  /** Total rounds in this tournament */
  totalRounds: int("totalRounds").notNull(),
  /** Current round index (0-based) */
  currentRound: int("currentRound").notNull().default(0),
  /** Wins accumulated by the player */
  wins: int("wins").notNull().default(0),
  /** Losses accumulated by the player */
  losses: int("losses").notNull().default(0),
  /** Prize coins awarded on completion */
  prizeCoins: int("prizeCoins").notNull().default(0),
  /** Coins actually awarded (set on completion) */
  coinsAwarded: int("coinsAwarded"),
  /** JSON: ordered list of AI character IDs for 'ai' type (stored as text for flexibility) */
  opponentIds: text("opponentIds"),
  /** JSON: full bracket state for 'bracket' type (stored as text for flexibility) */
  bracketData: text("bracketData"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  completedAt: timestamp("completedAt"),
}, (table) => ({
  userIdx: index("tournament_user_idx").on(table.userId),
  statusIdx: index("tournament_status_idx").on(table.status),
}));

export type Tournament = typeof tournaments.$inferSelect;
export type InsertTournament = typeof tournaments.$inferInsert;

/**
 * Tournament matches table
 * Stores each individual game played within a tournament.
 */
export const tournamentMatches = mysqlTable("tournamentMatches", {
  id: int("id").autoincrement().primaryKey(),
  tournamentId: int("tournamentId").notNull().references(() => tournaments.id, { onDelete: "cascade" }),
  /** The user who played this match */
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  /** Round index within the tournament (0-based) */
  roundIndex: int("roundIndex").notNull(),
  /** Match index within the round (for bracket tournaments) */
  matchIndex: int("matchIndex").notNull().default(0),
  /** Result from the perspective of userId */
  result: mysqlEnum("result", ["win", "lose"]).notNull(),
  /** Score string e.g. "12×8" */
  score: varchar("score", { length: 20 }).notNull(),
  /** Player's score as integer */
  scorePlayer: int("scorePlayer"),
  /** Opponent's score as integer */
  scoreOpponent: int("scoreOpponent"),
  /** Opponent name (AI character name or human player name) */
  opponentName: varchar("opponentName", { length: 100 }),
  /** Opponent avatar emoji */
  opponentAvatar: varchar("opponentAvatar", { length: 10 }),
  /** Game duration in seconds */
  durationSeconds: int("durationSeconds"),
  playedAt: timestamp("playedAt").defaultNow().notNull(),
}, (table) => ({
  tournamentIdx: index("tm_tournament_idx").on(table.tournamentId),
  userIdx: index("tm_user_idx").on(table.userId),
  roundIdx: index("tm_round_idx").on(table.tournamentId, table.roundIndex),
}));

export type TournamentMatch = typeof tournamentMatches.$inferSelect;
export type InsertTournamentMatch = typeof tournamentMatches.$inferInsert;

// ─── Online Multiplayer Tables ───────────────────────────────────────────────

/**
 * Online rooms for real-time multiplayer matches.
 */
export const onlineRooms = mysqlTable("onlineRooms", {
  id: int("id").autoincrement().primaryKey(),
  /** 4-char room code */
  code: varchar("code", { length: 10 }).notNull().unique(),
  /** Host user ID */
  hostId: int("hostId").notNull().references(() => users.id, { onDelete: "cascade" }),
  /** Host display name */
  hostName: varchar("hostName", { length: 100 }).notNull(),
  /** Guest user ID (null if waiting) */
  guestId: int("guestId").references(() => users.id, { onDelete: "set null" }),
  /** Guest display name */
  guestName: varchar("guestName", { length: 100 }),
  /** Game mode */
  mode: varchar("mode", { length: 10 }).notNull().default("1v1"),
  /** Stake level chosen when the room is created */
  stakeTier: varchar("stakeTier", { length: 16 }).notNull().default("amistoso"),
  /** Region selected by the host to help players find nearby opponents */
  region: varchar("region", { length: 8 }).notNull().default("BR"),
  /** Private rooms are visible only to the invited friend. */
  isPrivate: boolean("isPrivate").default(false).notNull(),
  /** Optional recipient authorized to join this private room. */
  privateInviteeId: int("privateInviteeId").references(() => users.id, { onDelete: "set null" }),
  /** Room status */
  status: mysqlEnum("status", ["waiting", "playing", "finished", "abandoned"]).notNull().default("waiting"),
  /** Online tournament ID if part of a tournament */
  tournamentId: int("tournamentId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  codeIdx: index("room_code_idx").on(table.code),
  statusIdx: index("room_status_idx").on(table.status),
  hostIdx: index("room_host_idx").on(table.hostId),
  filtersIdx: index("room_filters_idx").on(table.mode, table.stakeTier, table.region),
  privateInviteeIdx: index("room_private_invitee_idx").on(table.privateInviteeId, table.status),
}));

export type OnlineRoom = typeof onlineRooms.$inferSelect;
export type InsertOnlineRoom = typeof onlineRooms.$inferInsert;

// ─── Friends and private game invitations ─────────────────────────────────────

/** A directional friendship request. Reverse requests are accepted by the service layer. */
export const friendships = mysqlTable("friendships", {
  id: int("id").autoincrement().primaryKey(),
  requesterId: int("requesterId").notNull().references(() => users.id, { onDelete: "cascade" }),
  addresseeId: int("addresseeId").notNull().references(() => users.id, { onDelete: "cascade" }),
  status: mysqlEnum("status", ["pending", "accepted", "declined"]).notNull().default("pending"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  respondedAt: timestamp("respondedAt"),
}, (table) => ({
  requesterIdx: index("friend_requester_idx").on(table.requesterId, table.status),
  addresseeIdx: index("friend_addressee_idx").on(table.addresseeId, table.status),
  uniqueDirection: uniqueIndex("friend_direction_unique_idx").on(table.requesterId, table.addresseeId),
}));

export type Friendship = typeof friendships.$inferSelect;

/** Invitation from an accepted friend to a private online room. */
export const friendGameInvites = mysqlTable("friendGameInvites", {
  id: int("id").autoincrement().primaryKey(),
  senderId: int("senderId").notNull().references(() => users.id, { onDelete: "cascade" }),
  receiverId: int("receiverId").notNull().references(() => users.id, { onDelete: "cascade" }),
  roomCode: varchar("roomCode", { length: 10 }).notNull().references(() => onlineRooms.code, { onDelete: "cascade" }),
  status: mysqlEnum("status", ["pending", "accepted", "declined", "cancelled", "expired"]).notNull().default("pending"),
  expiresAt: timestamp("expiresAt").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  respondedAt: timestamp("respondedAt"),
}, (table) => ({
  receiverIdx: index("invite_receiver_idx").on(table.receiverId, table.status),
  roomIdx: index("invite_room_idx").on(table.roomCode),
  uniquePendingRoom: uniqueIndex("invite_sender_room_unique_idx").on(table.senderId, table.roomCode),
}));

export type FriendGameInvite = typeof friendGameInvites.$inferSelect;

/**
 * Snapshot autoritativo de uma partida em andamento. O estado é serializado
 * após cada transição crítica para permitir reconexão e recuperação em Autoscale.
 */
export const activeOnlineGames = mysqlTable("activeOnlineGames", {
  id: int("id").autoincrement().primaryKey(),
  roomCode: varchar("roomCode", { length: 10 }).notNull().unique(),
  player1Id: int("player1Id").notNull().references(() => users.id, { onDelete: "cascade" }),
  player1Name: varchar("player1Name", { length: 100 }).notNull(),
  player2Id: int("player2Id").notNull().references(() => users.id, { onDelete: "cascade" }),
  player2Name: varchar("player2Name", { length: 100 }).notNull(),
  /** JSON serializado de GameState; nunca é enviado diretamente ao adversário. */
  stateJson: text("stateJson").notNull(),
  /** Controle otimista de concorrência entre instâncias. */
  version: int("version").notNull().default(1),
  status: mysqlEnum("status", ["active", "finished", "abandoned"]).notNull().default("active"),
  /** Prazo absoluto do turno, em UTC, recuperável após reconexão. */
  turnDeadline: timestamp("turnDeadline"),
  lastEventId: varchar("lastEventId", { length: 64 }),
  /** Última reconexão confirmada de cada jogador, usada contra abandono entre instâncias. */
  player1ReconnectedAt: timestamp("player1ReconnectedAt"),
  player2ReconnectedAt: timestamp("player2ReconnectedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  roomIdx: index("aog_room_idx").on(table.roomCode),
  player1Idx: index("aog_p1_idx").on(table.player1Id),
  player2Idx: index("aog_p2_idx").on(table.player2Id),
  statusIdx: index("aog_status_idx").on(table.status),
}));

export type ActiveOnlineGame = typeof activeOnlineGames.$inferSelect;
export type InsertActiveOnlineGame = typeof activeOnlineGames.$inferInsert;

/**
 * Online match results (persisted after game ends).
 */
export const onlineMatches = mysqlTable("onlineMatches", {
  id: int("id").autoincrement().primaryKey(),
  roomCode: varchar("roomCode", { length: 10 }).notNull(),
  /** Player 1 (host) user ID */
  player1Id: int("player1Id").notNull().references(() => users.id, { onDelete: "cascade" }),
  player1Name: varchar("player1Name", { length: 100 }).notNull(),
  /** Player 2 (guest) user ID */
  player2Id: int("player2Id").notNull().references(() => users.id, { onDelete: "cascade" }),
  player2Name: varchar("player2Name", { length: 100 }).notNull(),
  /** Winner user ID */
  winnerId: int("winnerId").notNull().references(() => users.id, { onDelete: "cascade" }),
  scoreP1: int("scoreP1").notNull(),
  scoreP2: int("scoreP2").notNull(),
  mode: varchar("mode", { length: 10 }).notNull().default("1v1"),
  /** Duration in seconds */
  durationSeconds: int("durationSeconds"),
  /** Online tournament ID if part of a tournament */
  tournamentId: int("tournamentId"),
  /** WO = walkover (disconnect) */
  isWalkover: boolean("isWalkover").default(false).notNull(),
  playedAt: timestamp("playedAt").defaultNow().notNull(),
}, (table) => ({
  p1Idx: index("om_p1_idx").on(table.player1Id),
  p2Idx: index("om_p2_idx").on(table.player2Id),
  winnerIdx: index("om_winner_idx").on(table.winnerId),
  tournamentIdx: index("om_tournament_idx").on(table.tournamentId),
}));

export type OnlineMatch = typeof onlineMatches.$inferSelect;
export type InsertOnlineMatch = typeof onlineMatches.$inferInsert;

/**
 * Online tournaments (brackets between real players).
 */
export const onlineTournaments = mysqlTable("onlineTournaments", {
  id: int("id").autoincrement().primaryKey(),
  /** Creator user ID */
  creatorId: int("creatorId").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 100 }).notNull(),
  /** Max players (4, 8, 16) */
  maxPlayers: int("maxPlayers").notNull().default(8),
  /** Current status */
  status: mysqlEnum("status", ["registering", "active", "completed", "cancelled"]).notNull().default("registering"),
  /** Prize description */
  prize: varchar("prize", { length: 200 }),
  /** Horário de referência informado pelo organizador; o início continua manual. */
  scheduledStartAt: timestamp("scheduledStartAt"),
  /** JSON: bracket data (stored as text for flexibility) */
  bracketData: text("bracketData"),
  /** Total rounds */
  totalRounds: int("totalRounds").notNull(),
  /** Current round */
  currentRound: int("currentRound").notNull().default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  completedAt: timestamp("completedAt"),
  /** Chave do certificado do campeão no armazenamento privado. */
  championCertificateKey: varchar("championCertificateKey", { length: 255 }),
  /** URL emitida ao campeão quando o torneio é concluído. */
  championCertificateUrl: text("championCertificateUrl"),
}, (table) => ({
  statusIdx: index("ot_status_idx").on(table.status),
  creatorIdx: index("ot_creator_idx").on(table.creatorId),
}));

export type OnlineTournament = typeof onlineTournaments.$inferSelect;
export type InsertOnlineTournament = typeof onlineTournaments.$inferInsert;

/**
 * Online tournament participants.
 */
export const onlineTournamentPlayers = mysqlTable("onlineTournamentPlayers", {
  id: int("id").autoincrement().primaryKey(),
  tournamentId: int("tournamentId").notNull().references(() => onlineTournaments.id, { onDelete: "cascade" }),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  userName: varchar("userName", { length: 100 }).notNull(),
  /** Seed position in bracket */
  seed: int("seed").notNull().default(0),
  /** Has been eliminated? */
  eliminated: boolean("eliminated").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  tournamentIdx: index("otp_tournament_idx").on(table.tournamentId),
  userIdx: index("otp_user_idx").on(table.userId),
  /** UNIQUE: one entry per user per tournament */
  uniqueEntry: uniqueIndex("otp_unique_idx").on(table.tournamentId, table.userId),
}));

export type OnlineTournamentPlayer = typeof onlineTournamentPlayers.$inferSelect;
export type InsertOnlineTournamentPlayer = typeof onlineTournamentPlayers.$inferInsert;

// ─── Web Push de torneios ─────────────────────────────────────────────────────

/** Dispositivo que um jogador autorizou a receber notificações Web Push. */
export const pushSubscriptions = mysqlTable("pushSubscriptions", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  /** URL provida pelo navegador; nunca é enviada a outros jogadores. */
  endpoint: text("endpoint").notNull(),
  /** SHA-256 do endpoint, usado para índice único sem truncar o URL. */
  endpointHash: varchar("endpointHash", { length: 64 }).notNull(),
  p256dh: varchar("p256dh", { length: 512 }).notNull(),
  auth: varchar("auth", { length: 512 }).notNull(),
  userAgent: varchar("userAgent", { length: 512 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  userIdx: index("push_subscription_user_idx").on(table.userId),
  endpointUnique: uniqueIndex("push_subscription_endpoint_unique_idx").on(table.endpointHash),
}));

export type PushSubscription = typeof pushSubscriptions.$inferSelect;

/** Recibo por dispositivo que torna a entrega de cada janela de aviso idempotente. */
export const tournamentPushDeliveries = mysqlTable("tournamentPushDeliveries", {
  id: int("id").autoincrement().primaryKey(),
  tournamentId: int("tournamentId").notNull().references(() => onlineTournaments.id, { onDelete: "cascade" }),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  subscriptionId: int("subscriptionId").notNull().references(() => pushSubscriptions.id, { onDelete: "cascade" }),
  reminderKind: mysqlEnum("reminderKind", ["one_hour", "fifteen_minutes"]).notNull(),
  deliveredAt: timestamp("deliveredAt").defaultNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  tournamentUserIdx: index("tpd_tournament_user_idx").on(table.tournamentId, table.userId),
  subscriptionUnique: uniqueIndex("tpd_subscription_reminder_unique_idx").on(table.tournamentId, table.subscriptionId, table.reminderKind),
}));

export type TournamentPushDelivery = typeof tournamentPushDeliveries.$inferSelect;

/** Tarefas periódicas de nível do projeto, vinculadas ao task UID emitido pela plataforma. */
export const scheduledJobs = mysqlTable("scheduledJobs", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 80 }).notNull(),
  taskUid: varchar("taskUid", { length: 65 }).notNull(),
  cronExpression: varchar("cronExpression", { length: 64 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  nameUnique: uniqueIndex("scheduled_job_name_unique_idx").on(table.name),
  taskUidUnique: uniqueIndex("scheduled_job_task_uid_unique_idx").on(table.taskUid),
}));

export type ScheduledJob = typeof scheduledJobs.$inferSelect;

// ─── Central de notificações ──────────────────────────────────────────────────

/** Histórico pessoal de avisos recebidos, preservado mesmo após a notificação push. */
export const userNotifications = mysqlTable("userNotifications", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  kind: mysqlEnum("kind", ["tournament_reminder", "in_person_table"]).notNull(),
  title: varchar("title", { length: 180 }).notNull(),
  body: varchar("body", { length: 500 }).notNull(),
  targetUrl: varchar("targetUrl", { length: 500 }),
  metadataJson: text("metadataJson"),
  readAt: timestamp("readAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  userCreatedIdx: index("notification_user_created_idx").on(table.userId, table.createdAt),
  userUnreadIdx: index("notification_user_unread_idx").on(table.userId, table.readAt),
}));

export type UserNotification = typeof userNotifications.$inferSelect;

// ─── Mesa Presencial ──────────────────────────────────────────────────────────

/** Uma sala privada temporária cujo segundo assento é liberado por QR Code. */
export const inPersonTables = mysqlTable("inPersonTables", {
  id: int("id").autoincrement().primaryKey(),
  roomCode: varchar("roomCode", { length: 10 }).notNull().unique().references(() => onlineRooms.code, { onDelete: "cascade" }),
  hostId: int("hostId").notNull().references(() => users.id, { onDelete: "cascade" }),
  guestId: int("guestId").references(() => users.id, { onDelete: "set null" }),
  inviteTokenHash: varchar("inviteTokenHash", { length: 64 }).notNull(),
  status: mysqlEnum("status", ["waiting", "playing", "expired", "cancelled"]).notNull().default("waiting"),
  expiresAt: timestamp("expiresAt").notNull(),
  joinedAt: timestamp("joinedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  hostStatusIdx: index("in_person_host_status_idx").on(table.hostId, table.status),
  expiryIdx: index("in_person_expiry_idx").on(table.status, table.expiresAt),
}));

export type InPersonTable = typeof inPersonTables.$inferSelect;

// ─── Auditoria de autoverificações de regras ──────────────────────────────────

/**
 * Histórico administrativo de cada execução determinística de Truco, Envido e
 * Flor. O diagnóstico completo fica serializado para consulta e exportação.
 */
export const rulesTestExecutions = mysqlTable("rulesTestExecutions", {
  id: int("id").autoincrement().primaryKey(),
  status: mysqlEnum("status", ["passed", "failed"]).notNull(),
  passedChecks: int("passedChecks").notNull(),
  totalChecks: int("totalChecks").notNull(),
  /** JSON com os checks reprovados; vazio quando a execução for aprovada. */
  failedChecksJson: text("failedChecksJson").notNull(),
  /** Administrador que abriu o relatório e disparou a autoverificação. */
  executedById: int("executedById").references(() => users.id, { onDelete: "set null" }),
  executedByName: varchar("executedByName", { length: 100 }),
  /** Indica se o alerta ao proprietário do projeto foi aceito pelo serviço. */
  ownerNotified: boolean("ownerNotified").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  statusCreatedIdx: index("rte_status_created_idx").on(table.status, table.createdAt),
  createdIdx: index("rte_created_idx").on(table.createdAt),
}));

export type RulesTestExecution = typeof rulesTestExecutions.$inferSelect;
export type InsertRulesTestExecution = typeof rulesTestExecutions.$inferInsert;

// ─── Sponsors / Patrocinadores ─────────────────────────────────────────────────────────

/**
 * Sponsors table — stores sponsor banners (image or video) shown during games.
 * Each sponsor can be placed at the top or bottom of the game screen.
 * Multiple sponsors rotate in a carousel.
 */
export const sponsors = mysqlTable("sponsors", {
  id: int("id").autoincrement().primaryKey(),
  /** Sponsor/company name */
  name: varchar("name", { length: 200 }).notNull(),
  /** CDN URL of the media (image or video) */
  mediaUrl: text("mediaUrl").notNull(),
  /** Type of media */
  mediaType: mysqlEnum("mediaType", ["image", "video"]).notNull().default("image"),
  /** Optional click-through URL */
  linkUrl: text("linkUrl"),
  /** Where to display the banner */
  position: mysqlEnum("position", ["top", "bottom"]).notNull().default("bottom"),
  /** Whether this sponsor is currently active */
  active: boolean("active").default(true).notNull(),
  /** Display order (lower = first) */
  displayOrder: int("displayOrder").default(0).notNull(),
  /** Duration in seconds for each slide in carousel (default 8s) */
  slideDuration: int("slideDuration").default(8).notNull(),
  /** Daily impression goal — when reached, admin is notified (0 = disabled) */
  dailyImpressionGoal: int("dailyImpressionGoal").default(0).notNull(),
  /** Campaign start date (null = always active) */
  startDate: date("startDate", { mode: "string" }),
  /** Campaign end date (null = no end) */
  endDate: date("endDate", { mode: "string" }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  activeIdx: index("sponsor_active_idx").on(table.active),
  orderIdx: index("sponsor_order_idx").on(table.displayOrder),
}));

export type Sponsor = typeof sponsors.$inferSelect;
export type InsertSponsor = typeof sponsors.$inferInsert;

/**
 * Sponsor events table — tracks impressions and clicks per sponsor.
 * Aggregated daily for efficient reporting.
 */
export const sponsorEvents = mysqlTable("sponsorEvents", {
  id: int("id").autoincrement().primaryKey(),
  /** Sponsor ID */
  sponsorId: int("sponsorId").notNull().references(() => sponsors.id, { onDelete: "cascade" }),
  /** Event type: impression or click */
  eventType: mysqlEnum("eventType", ["impression", "click"]).notNull(),
  /** Date of the event (aggregated daily) */
  eventDate: varchar("eventDate", { length: 10 }).notNull(),
  /** Count of events for this sponsor on this date */
  count: int("count").default(1).notNull(),
}, (table) => ({
  sponsorIdx: index("se_sponsor_idx").on(table.sponsorId),
  dateIdx: index("se_date_idx").on(table.eventDate),
  /** UNIQUE: one row per sponsor/eventType/day — prevents duplicate aggregation */
  uniqueIdx: uniqueIndex("se_unique_idx").on(table.sponsorId, table.eventType, table.eventDate),
}));

export type SponsorEvent = typeof sponsorEvents.$inferSelect;
export type InsertSponsorEvent = typeof sponsorEvents.$inferInsert;

// ─── Pilas (Moeda Virtual) ──────────────────────────────────────────────────

/**
 * Pilas balance — each user has a single row tracking their current balance.
 * 1 Pila = R$1,00
 */
export const pilasBalance = mysqlTable("pilasBalance", {
  id: int("id").autoincrement().primaryKey(),
  /** User ID (unique — one balance per user) */
  userId: int("userId").notNull().unique().references(() => users.id, { onDelete: "cascade" }),
  /** Current balance in pilas (integer, 1 pila = R$1) */
  balance: int("balance").default(0).notNull(),
  /** Total pilas ever purchased */
  totalPurchased: int("totalPurchased").default(0).notNull(),
  /** Total pilas ever spent */
  totalSpent: int("totalSpent").default(0).notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  userIdx: index("pb_user_idx").on(table.userId),
}));

export type PilasBalance = typeof pilasBalance.$inferSelect;
export type InsertPilasBalance = typeof pilasBalance.$inferInsert;

/**
 * Pilas transactions — full audit log of all pila movements.
 * type: 'purchase' = bought with real money
 *       'spend' = used in-game (tournament entry, skin, etc.)
 *       'reward' = earned from gameplay
 *       'refund' = returned from cancelled purchase
 */
export const pilasTransactions = mysqlTable("pilasTransactions", {
  id: int("id").autoincrement().primaryKey(),
  /** User ID */
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  /** Transaction type */
  type: mysqlEnum("type", ["purchase", "spend", "reward", "refund"]).notNull(),
  /** Amount of pilas (positive for credit, negative for debit) */
  amount: int("amount").notNull(),
  /** Description of the transaction */
  description: varchar("description", { length: 255 }).notNull(),
  /** Reference ID (e.g., Mercado Pago payment ID, tournament ID) */
  referenceId: varchar("referenceId", { length: 255 }),
  /** Balance after this transaction */
  balanceAfter: int("balanceAfter").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  userIdx: index("pt_user_idx").on(table.userId),
  typeIdx: index("pt_type_idx").on(table.type),
  refIdx: index("pt_ref_idx").on(table.referenceId),
}));

export type PilasTransaction = typeof pilasTransactions.$inferSelect;
export type InsertPilasTransaction = typeof pilasTransactions.$inferInsert;

/**
 * Pilas packages — predefined purchase options.
 * Each package has a pila amount and a price in BRL.
 */
export const pilasPackages = mysqlTable("pilasPackages", {
  id: int("id").autoincrement().primaryKey(),
  /** Package name (e.g., "Pacote Peão", "Pacote Estancieiro") */
  name: varchar("name", { length: 100 }).notNull(),
  /** Amount of pilas in this package */
  pilas: int("pilas").notNull(),
  /** Price in BRL cents (e.g., 500 = R$5,00) */
  priceCents: int("priceCents").notNull(),
  /** Bonus pilas (extra pilas included) */
  bonusPilas: int("bonusPilas").default(0).notNull(),
  /** Whether this package is currently available */
  active: boolean("active").default(true).notNull(),
  /** Display order (lower = first) */
  displayOrder: int("displayOrder").default(0).notNull(),
  /** Optional badge text (e.g., "Mais Popular", "Melhor Valor") */
  badge: varchar("badge", { length: 50 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  activeIdx: index("pp_active_idx").on(table.active),
  orderIdx: index("pp_order_idx").on(table.displayOrder),
}));

export type PilasPackage = typeof pilasPackages.$inferSelect;
export type InsertPilasPackage = typeof pilasPackages.$inferInsert;

/**
 * Pix payments — tracks Mercado Pago Pix payment lifecycle.
 * Links a Mercado Pago payment to a user and package for reconciliation.
 */
export const pixPayments = mysqlTable("pixPayments", {
  id: int("id").autoincrement().primaryKey(),
  /** User who initiated the payment */
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  /** Package being purchased */
  packageId: int("packageId").notNull().references(() => pilasPackages.id, { onDelete: "restrict" }),
  /** Mercado Pago payment ID */
  mpPaymentId: varchar("mpPaymentId", { length: 64 }).notNull().unique(),
  /** Payment status: pending, approved, rejected, cancelled, refunded */
  status: mysqlEnum("status", ["pending", "approved", "rejected", "cancelled", "refunded"]).notNull().default("pending"),
  /** Amount in BRL cents */
  amountCents: int("amountCents").notNull(),
  /** Pilas to credit (package pilas + bonus) */
  pilasToCredit: int("pilasToCredit").notNull(),
  /** Whether pilas have been credited to the user */
  credited: boolean("credited").default(false).notNull(),
  /** Pix QR code (copia-e-cola) */
  qrCode: text("qrCode"),
  /** Pix QR code base64 image */
  qrCodeBase64: text("qrCodeBase64"),
  /** Ticket URL (Mercado Pago payment page) */
  ticketUrl: text("ticketUrl"),
  /** Expiration date of the Pix */
  expiresAt: timestamp("expiresAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  userIdx: index("pxp_user_idx").on(table.userId),
  mpIdx: index("pxp_mp_idx").on(table.mpPaymentId),
  statusIdx: index("pxp_status_idx").on(table.status),
}));

export type PixPayment = typeof pixPayments.$inferSelect;
export type InsertPixPayment = typeof pixPayments.$inferInsert;

/**
 * User purchases — items bought with Pilas in the shop.
 * Tracks which shop items (skins, themes, avatars) a user has unlocked.
 */
export const userPurchases = mysqlTable("userPurchases", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  /** Category: 'skins' | 'themes' | 'avatars' */
  category: varchar("category", { length: 20 }).notNull(),
  /** Item ID within the category (e.g., 'gaucho_real', 'farroupilha') */
  itemId: varchar("itemId", { length: 50 }).notNull(),
  /** Price paid in Pilas */
  pricePilas: int("pricePilas").notNull(),
  /** Reference to the pilas transaction */
  transactionId: int("transactionId").references(() => pilasTransactions.id, { onDelete: "set null" }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  userIdx: index("user_purchases_user_idx").on(table.userId),
  /** UNIQUE: a user can only purchase each item once */
  uniqueItem: uniqueIndex("user_purchases_unique_idx").on(table.userId, table.category, table.itemId),
}));

export type UserPurchase = typeof userPurchases.$inferSelect;
export type InsertUserPurchase = typeof userPurchases.$inferInsert;
