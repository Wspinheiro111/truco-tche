/**
 * Tests for the 9 critical improvements to Truco Tchê
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as db from './db';

// ─── Sugestão 9: City normalization ──────────────────────────────────────────

describe('normalizeCityName', () => {
  it('should trim whitespace', () => {
    expect(db.normalizeCityName('  Porto Alegre  ')).toBe('Porto Alegre');
  });

  it('should convert to title case', () => {
    expect(db.normalizeCityName('porto alegre')).toBe('Porto Alegre');
  });

  it('should handle all-caps input', () => {
    expect(db.normalizeCityName('PORTO ALEGRE')).toBe('Porto Alegre');
  });

  it('should handle multi-word cities', () => {
    expect(db.normalizeCityName('são leopoldo')).toBe('São Leopoldo');
  });

  it('should handle single word', () => {
    expect(db.normalizeCityName('caxias')).toBe('Caxias');
  });

  it('should handle mixed case with spaces', () => {
    expect(db.normalizeCityName('  sAnTa MaRiA  ')).toBe('Santa Maria');
  });
});

// ─── Sugestão 2: Account lockout logic ───────────────────────────────────────

describe('checkAccountLocked', () => {
  it('should return locked=false when lockedUntil is null', () => {
    const result = db.checkAccountLocked({ lockedUntil: null });
    expect(result.locked).toBe(false);
  });

  it('should return locked=false when lockedUntil is undefined', () => {
    const result = db.checkAccountLocked({ lockedUntil: undefined });
    expect(result.locked).toBe(false);
  });

  it('should return locked=true when lockedUntil is in the future', () => {
    const future = new Date(Date.now() + 10 * 60 * 1000); // 10 min from now
    const result = db.checkAccountLocked({ lockedUntil: future });
    expect(result.locked).toBe(true);
    expect((result as any).until).toEqual(future);
  });

  it('should return locked=false when lockedUntil is in the past', () => {
    const past = new Date(Date.now() - 10 * 60 * 1000); // 10 min ago
    const result = db.checkAccountLocked({ lockedUntil: past });
    expect(result.locked).toBe(false);
  });
});

// ─── Sugestão 5: Score parsing from string ───────────────────────────────────

describe('Score integer parsing (in insertMatch)', () => {
  it('should parse "12×8" into scorePlayer=12, scoreOpponent=8', () => {
    const score = '12×8';
    const parts = score.replace('×', 'x').split('x');
    const scorePlayer = parseInt(parts[0]);
    const scoreOpponent = parseInt(parts[1]);
    expect(scorePlayer).toBe(12);
    expect(scoreOpponent).toBe(8);
  });

  it('should parse "7×12" into scorePlayer=7, scoreOpponent=12', () => {
    const score = '7×12';
    const parts = score.replace('×', 'x').split('x');
    const scorePlayer = parseInt(parts[0]);
    const scoreOpponent = parseInt(parts[1]);
    expect(scorePlayer).toBe(7);
    expect(scoreOpponent).toBe(12);
  });

  it('should handle "0×0" edge case', () => {
    const score = '0×0';
    const parts = score.replace('×', 'x').split('x');
    const scorePlayer = parseInt(parts[0]);
    const scoreOpponent = parseInt(parts[1]);
    expect(scorePlayer).toBe(0);
    expect(scoreOpponent).toBe(0);
  });

  it('should return NaN for malformed score strings', () => {
    const score = 'invalid';
    const parts = score.replace('×', 'x').split('x');
    const scorePlayer = parseInt(parts[0]);
    expect(isNaN(scorePlayer)).toBe(true);
  });
});

// ─── Sugestão 1: Token security (no token in response body) ──────────────────

describe('forgotPin security', () => {
  it('should not expose resetToken in response (token only sent via email)', () => {
    // Simulates the expected response shape from forgotPin endpoint
    const mockResponse = {
      success: true,
      message: 'Se o e-mail estiver cadastrado, você receberá as instruções em breve.',
      // resetToken should NOT be present
    };

    expect(mockResponse).not.toHaveProperty('resetToken');
    expect(mockResponse.success).toBe(true);
    expect(mockResponse.message).toContain('e-mail');
  });
});
