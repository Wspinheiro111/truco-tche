import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { appRouter } from './routers';
import { buildProfileDashboard } from './localAuth';
import type { TrpcContext } from './_core/context';

describe('profile dashboard', () => {
  it('returns zeroed statistics and an empty timeline for a player without matches', () => {
    const result = buildProfileDashboard(7, [], []);
    expect(result.stats).toEqual({
      wins: 0,
      losses: 0,
      total: 0,
      winRate: 0,
      onlineMatches: 0,
      averageScore: null,
      averageOpponentScore: null,
    });
    expect(result.recentMatches).toEqual([]);
  });

  it('combines local and online matches and calculates persistent win statistics', () => {
    const result = buildProfileDashboard(7, [
      { id: 1, result: 'win', score: '12 × 8', scorePlayer: 12, scoreOpponent: 8, characterName: 'Luna', characterAvatar: '🦊', durationSeconds: 300, playedAt: new Date('2026-08-10T10:00:00Z') },
    ], [
      { id: 2, player1Id: 7, player1Name: 'Will', player2Id: 9, player2Name: 'Duda', winnerId: 9, scoreP1: 9, scoreP2: 12, mode: '1v1', durationSeconds: 480, isWalkover: false, playedAt: new Date('2026-08-11T10:00:00Z') },
    ]);

    expect(result.stats).toMatchObject({ wins: 1, losses: 1, total: 2, winRate: 50, onlineMatches: 1 });
    expect(result.recentMatches[0]).toMatchObject({ source: 'online', opponent: 'Duda', result: 'lose' });
  });

  it('rejects dashboard access without an authenticated user', async () => {
    const context = {
      user: null,
      req: { protocol: 'https', headers: {} },
      res: { clearCookie: () => {} },
    } as unknown as TrpcContext;
    const caller = appRouter.createCaller(context);
    await expect(caller.localAuth.profileDashboard()).rejects.toThrow();
  });

  it('keeps loading, empty and retryable error states in the profile interface', () => {
    const page = readFileSync(resolve(process.cwd(), 'client/index.html'), 'utf8');
    expect(page).toContain('Carregando seu desempenho...');
    expect(page).toContain('Ainda não há partidas registradas');
    expect(page).toContain('Não foi possível carregar o perfil');
    expect(page).toContain('Tentar novamente');
  });
});
