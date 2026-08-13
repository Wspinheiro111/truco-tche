import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import type { Express, Request, Response } from "express";
import * as db from "../db";
import { getSessionCookieOptions } from "./cookies";
import { sdk } from "./sdk";

function getQueryParam(req: Request, key: string): string | undefined {
  const value = req.query[key];
  return typeof value === "string" ? value : undefined;
}

export function registerOAuthRoutes(app: Express) {
  app.get("/api/oauth/callback", async (req: Request, res: Response) => {
    const code = getQueryParam(req, "code");
    const state = getQueryParam(req, "state");

    if (!code || !state) {
      res.status(400).json({ error: "code and state are required" });
      return;
    }

    try {
      const tokenResponse = await sdk.exchangeCodeForToken(code, state);
      const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);

      if (!userInfo.openId) {
        res.status(400).json({ error: "openId missing from user info" });
        return;
      }

      // ─── Account Linking Logic ─────────────────────────────────────────────────────────────
      // If the user has an email and a local account exists with that email,
      // link the Google openId to the existing local account so all history
      // (matches, Pilas, achievements) is preserved under one profile.
      let finalOpenId = userInfo.openId;
      let accountLinked = false;

      if (userInfo.email) {
        const existingLocalUser = await db.getUserByEmail(userInfo.email.toLowerCase());
        if (existingLocalUser && existingLocalUser.loginMethod === 'local' && !existingLocalUser.googleLinked) {
          // Migrate: update the local user's openId to the Google openId
          await db.linkGoogleAccount(existingLocalUser.id, userInfo.openId);
          finalOpenId = userInfo.openId;
          accountLinked = true;
          console.log(`[OAuth] Linked Google account to existing local user id=${existingLocalUser.id} email=${userInfo.email}`);
        }
      }

      // Upsert the OAuth user (creates new or updates existing linked account)
      await db.upsertUser({
        openId: finalOpenId,
        name: userInfo.name || null,
        email: userInfo.email ?? null,
        loginMethod: userInfo.loginMethod ?? userInfo.platform ?? 'google',
        lastSignedIn: new Date(),
      });

      const sessionToken = await sdk.createSessionToken(finalOpenId, {
        name: userInfo.name || "",
        expiresInMs: ONE_YEAR_MS,
      });

      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });

      // Redirect with a flag so the frontend can show a "conta vinculada" toast
      const redirectPath = accountLinked ? "/?linked=google" : "/";
      res.redirect(302, redirectPath);
    } catch (error) {
      console.error("[OAuth] Callback failed", error);
      res.status(500).json({ error: "OAuth callback failed" });
    }
  });
}
