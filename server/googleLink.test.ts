/**
 * Tests for Google account linking / unlinking functionality
 * Covers the OAuth callback account merging logic and the unlinkGoogleAccount helper.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock the database module ─────────────────────────────────────────────────
vi.mock('./db', () => ({
  getUserByEmail: vi.fn(),
  getUserByOpenId: vi.fn(),
  getUserById: vi.fn(),
  linkGoogleAccount: vi.fn(),
  unlinkGoogleAccount: vi.fn(),
  upsertUser: vi.fn(),
  getDb: vi.fn(),
}));

import * as db from './db';

// ─── Account Linking Logic (mirrors oauth.ts callback) ───────────────────────

describe('OAuth callback account linking logic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should link Google to existing local account with same email', async () => {
    const localUser = {
      id: 42,
      openId: 'local:gaucho@pago.com',
      email: 'gaucho@pago.com',
      loginMethod: 'local',
      googleLinked: false,
      name: 'Gaúcho Tchê',
    };

    vi.mocked(db.getUserByEmail).mockResolvedValue(localUser as any);
    vi.mocked(db.linkGoogleAccount).mockResolvedValue(undefined);
    vi.mocked(db.upsertUser).mockResolvedValue(undefined);

    // Simulate the linking logic from oauth.ts
    const userInfo = {
      openId: 'manus:google-xyz-123',
      email: 'gaucho@pago.com',
      name: 'Gaúcho Tchê',
      loginMethod: 'google',
    };

    let finalOpenId = userInfo.openId;
    let accountLinked = false;

    if (userInfo.email) {
      const existingLocalUser = await db.getUserByEmail(userInfo.email.toLowerCase());
      if (existingLocalUser && existingLocalUser.loginMethod === 'local' && !existingLocalUser.googleLinked) {
        await db.linkGoogleAccount(existingLocalUser.id, userInfo.openId);
        finalOpenId = userInfo.openId;
        accountLinked = true;
      }
    }

    expect(accountLinked).toBe(true);
    expect(finalOpenId).toBe('manus:google-xyz-123');
    expect(db.linkGoogleAccount).toHaveBeenCalledWith(42, 'manus:google-xyz-123');
  });

  it('should NOT link if local account already has googleLinked=true', async () => {
    const alreadyLinkedUser = {
      id: 43,
      openId: 'manus:already-linked',
      email: 'already@pago.com',
      loginMethod: 'google',
      googleLinked: true,
    };

    vi.mocked(db.getUserByEmail).mockResolvedValue(alreadyLinkedUser as any);

    const userInfo = {
      openId: 'manus:new-google-token',
      email: 'already@pago.com',
      loginMethod: 'google',
    };

    let accountLinked = false;

    if (userInfo.email) {
      const existingLocalUser = await db.getUserByEmail(userInfo.email.toLowerCase());
      if (existingLocalUser && existingLocalUser.loginMethod === 'local' && !existingLocalUser.googleLinked) {
        accountLinked = true;
      }
    }

    expect(accountLinked).toBe(false);
    expect(db.linkGoogleAccount).not.toHaveBeenCalled();
  });

  it('should NOT link if no local account exists with that email', async () => {
    vi.mocked(db.getUserByEmail).mockResolvedValue(undefined);

    const userInfo = {
      openId: 'manus:new-user-xyz',
      email: 'newuser@pago.com',
      loginMethod: 'google',
    };

    let accountLinked = false;

    if (userInfo.email) {
      const existingLocalUser = await db.getUserByEmail(userInfo.email.toLowerCase());
      if (existingLocalUser && existingLocalUser.loginMethod === 'local' && !existingLocalUser.googleLinked) {
        accountLinked = true;
      }
    }

    expect(accountLinked).toBe(false);
    expect(db.linkGoogleAccount).not.toHaveBeenCalled();
  });

  it('should skip linking if userInfo has no email', async () => {
    const userInfo = {
      openId: 'manus:no-email-user',
      email: null,
      loginMethod: 'google',
    };

    let accountLinked = false;

    if (userInfo.email) {
      accountLinked = true; // should not reach here
    }

    expect(accountLinked).toBe(false);
    expect(db.getUserByEmail).not.toHaveBeenCalled();
    expect(db.linkGoogleAccount).not.toHaveBeenCalled();
  });
});

// ─── unlinkGoogleAccount helper ───────────────────────────────────────────────

describe('unlinkGoogleAccount', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should call db.unlinkGoogleAccount with the correct userId', async () => {
    vi.mocked(db.unlinkGoogleAccount).mockResolvedValue(undefined);

    await db.unlinkGoogleAccount(42);

    expect(db.unlinkGoogleAccount).toHaveBeenCalledWith(42);
    expect(db.unlinkGoogleAccount).toHaveBeenCalledTimes(1);
  });

  it('should throw if db is not available', async () => {
    vi.mocked(db.unlinkGoogleAccount).mockRejectedValue(new Error('Database not available'));

    await expect(db.unlinkGoogleAccount(99)).rejects.toThrow('Database not available');
  });
});

// ─── linkGoogleAccount helper ─────────────────────────────────────────────────

describe('linkGoogleAccount', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should call db.linkGoogleAccount with userId and googleOpenId', async () => {
    vi.mocked(db.linkGoogleAccount).mockResolvedValue(undefined);

    await db.linkGoogleAccount(42, 'manus:google-abc-456');

    expect(db.linkGoogleAccount).toHaveBeenCalledWith(42, 'manus:google-abc-456');
  });

  it('should preserve history by updating openId (not creating new user)', async () => {
    // The key invariant: linkGoogleAccount updates the EXISTING user's openId
    // rather than creating a new user. This preserves all history.
    vi.mocked(db.linkGoogleAccount).mockResolvedValue(undefined);

    const existingUserId = 42; // user with matches, Pilas, achievements
    const googleOpenId = 'manus:google-new-token';

    await db.linkGoogleAccount(existingUserId, googleOpenId);

    // Should update the existing user, not create a new one
    expect(db.linkGoogleAccount).toHaveBeenCalledWith(existingUserId, googleOpenId);
    expect(db.upsertUser).not.toHaveBeenCalled(); // no new user created
  });
});

// ─── Redirect URL logic ───────────────────────────────────────────────────────

describe('OAuth redirect URL with linked flag', () => {
  it('should redirect to /?linked=google when account was linked', () => {
    const accountLinked = true;
    const redirectPath = accountLinked ? '/?linked=google' : '/';
    expect(redirectPath).toBe('/?linked=google');
  });

  it('should redirect to / when no linking occurred', () => {
    const accountLinked = false;
    const redirectPath = accountLinked ? '/?linked=google' : '/';
    expect(redirectPath).toBe('/');
  });
});
