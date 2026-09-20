import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { env } from "./config.js";
import { prisma } from "./prisma.js";
import type { AuthUser } from "./types.js";

/**
 * Create access token.
 *
 * The access token contains the user ID.
 * The current role is resolved from the database
 * inside the authentication middleware.
 */
export const signAccess = (u: AuthUser) =>
  jwt.sign(
    { id: u.id },
    env.JWT_ACCESS_SECRET,
    {
      expiresIn: "15m",
    }
  );

/**
 * Create refresh token.
 *
 * IMPORTANT:
 * Do not store role inside refresh token.
 * The database is the source of truth for the user's
 * current role.
 */
export const signRefresh = (u: AuthUser) =>
  jwt.sign(
    { id: u.id },
    env.JWT_REFRESH_SECRET,
    {
      expiresIn: "7d",
    }
  );

/**
 * Hash refresh token before storing it in the database.
 */
export const hashToken = (token: string) =>
  crypto
    .createHash("sha256")
    .update(token)
    .digest("hex");

/**
 * Verify access token.
 *
 * Only the user ID is trusted from the token.
 * The current role is loaded from PostgreSQL
 * by authenticate() middleware.
 */
export const verifyAccess = (token: string) =>
  jwt.verify(
    token,
    env.JWT_ACCESS_SECRET
  ) as {
    id: string;
  };

/**
 * Verify refresh token.
 *
 * Refresh token contains only user ID.
 */
export const verifyRefresh = (token: string) =>
  jwt.verify(
    token,
    env.JWT_REFRESH_SECRET
  ) as {
    id: string;
  };

/**
 * Store hashed refresh token in database.
 */
export async function saveRefreshToken(
  user: AuthUser,
  token: string
) {
  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(token),
      expiresAt: new Date(
        Date.now() + 7 * 864e5
      ),
    },
  });
}

/**
 * Refresh token cookie configuration.
 *
 * HttpOnly:
 *   JavaScript cannot access the refresh token.
 *
 * Secure:
 *   HTTPS in production.
 *
 * SameSite:
 *   None in production because frontend and backend
 *   may be hosted on different domains.
 */
const isProduction =
  process.env.NODE_ENV === "production";

export const cookieOptions = {
  httpOnly: true,
  secure: isProduction,
  sameSite: (isProduction
    ? "none"
    : "lax") as "none" | "lax",
  path: "/api/auth",
  maxAge: 7 * 864e5,
};