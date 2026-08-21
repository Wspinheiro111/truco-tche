export type LocalSocketAuthPayload = { userId: number; userName: string };

export function parseLocalSocketAuthPayload(value: unknown): LocalSocketAuthPayload | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as { userId?: unknown; userName?: unknown };
  const userId = Number(candidate.userId);
  const userName = typeof candidate.userName === "string" ? candidate.userName.trim() : "";
  if (!Number.isSafeInteger(userId) || userId <= 0 || !userName || userName.length > 100) return null;
  return { userId, userName };
}

export function isLoopbackSocketAddress(address: unknown): boolean {
  if (typeof address !== "string") return false;
  const normalized = address.trim().toLowerCase();
  return normalized === "127.0.0.1" || normalized === "::1" || normalized === "::ffff:127.0.0.1";
}

export function canUseRoomScope(currentRoomCode: string | undefined, requestedRoomCode: string): boolean {
  return !currentRoomCode || currentRoomCode === requestedRoomCode;
}
