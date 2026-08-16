export type TournamentEntrant = {
  userId: number;
  userName: string;
};

export type OnlineTournamentMatch = {
  round: number;
  matchIndex: number;
  p1UserId: number;
  p2UserId: number | null;
  p1Name: string;
  p2Name: string | null;
  roomCode?: string;
  winnerId?: number;
  winnerName?: string;
  isBye?: boolean;
};

export function validateOneVsOneCapacity(capacity: number): string | null {
  if (!Number.isInteger(capacity) || capacity < 2 || capacity > 64) {
    return "Escolha entre 2 e 64 jogadores.";
  }
  if (capacity % 2 !== 0) {
    return "Torneio mano a mano exige um número par de jogadores.";
  }
  return null;
}

export function roundCountForCapacity(capacity: number): number {
  return Math.ceil(Math.log2(capacity));
}

export function seededShuffle<T>(items: T[], random: () => number): T[] {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

/**
 * Builds the opening round from a fair player draw. For brackets that are not
 * powers of two, the final unmatched entrant receives a declared bye and is
 * automatically carried into the following round by the bracket processor.
 */
export function buildOneVsOneOpeningRound(
  entrants: TournamentEntrant[],
  random: () => number = Math.random,
): OnlineTournamentMatch[] {
  const capacityError = validateOneVsOneCapacity(entrants.length);
  if (capacityError) throw new Error(capacityError);

  const shuffled = seededShuffle(entrants, random);
  const matches: OnlineTournamentMatch[] = [];
  for (let index = 0; index < shuffled.length; index += 2) {
    const p1 = shuffled[index];
    const p2 = shuffled[index + 1] ?? null;
    matches.push({
      round: 0,
      matchIndex: matches.length,
      p1UserId: p1.userId,
      p1Name: p1.userName,
      p2UserId: p2?.userId ?? null,
      p2Name: p2?.userName ?? null,
      ...(p2 ? {} : { winnerId: p1.userId, winnerName: p1.userName, isBye: true }),
    });
  }
  return matches;
}
