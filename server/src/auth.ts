import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import type { Response, NextFunction } from "express";
import { Role } from "@prisma/client";
import { env, environmentDiagnostic, missingEnvironmentKeys } from "./config.js";
import { logger, prisma } from "./lib.js";
import type { AuthRequest, JwtPayload } from "./types.js";

export const hashPassword = (password: string) => bcrypt.hash(password, 12);
export const authConfigurationError = () => missingEnvironmentKeys.length ? environmentDiagnostic() : undefined;
export const verifyPassword = async (password: string, hash: string) => {
  try { return await bcrypt.compare(password, hash); } catch { return false; }
};

/** Migrates legacy plaintext seed passwords only after a successful login. */
export async function verifyAndMigratePassword(userId: string, password: string, storedPassword: string): Promise<boolean> {
  if (storedPassword.startsWith("$2a$") || storedPassword.startsWith("$2b$") || storedPassword.startsWith("$2y$")) {
    return verifyPassword(password, storedPassword);
  }
  if (storedPassword !== password) return false;
  await prisma.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(password) } });
  logger.warn("Migrated a legacy plaintext password during successful login", { userId });
  return true;
}

export const signAccess = (user: { id: string; role: Role; email: string }) => jwt.sign({ sub: user.id, role: user.role, email: user.email }, env.JWT_ACCESS_SECRET, { expiresIn: "15m" });
export const signRefresh = (user: { id: string; role: Role; email: string }) => jwt.sign({ sub: user.id, role: user.role, email: user.email }, env.JWT_REFRESH_SECRET, { expiresIn: "7d" });
export function setRefreshCookie(res: Response, token: string) { res.cookie("refreshToken", token, { httpOnly: true, secure: env.NODE_ENV === "production", sameSite: "lax", maxAge: 7 * 86400000, path: "/api/auth" }); }
export async function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const configurationError = authConfigurationError();
    if (configurationError) return res.status(503).json({ message: configurationError });
    const raw = req.headers.authorization?.replace(/^Bearer\s+/i, "");
    if (!raw) return res.status(401).json({ message: "Authentication required" });
    const payload = jwt.verify(raw, env.JWT_ACCESS_SECRET) as JwtPayload;
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user?.active) return res.status(401).json({ message: "Session is no longer valid" });
    req.user = payload;
    next();
  } catch (error) {
    logger.warn("Authentication middleware rejected token", { reason: error instanceof Error ? error.message : "Unknown JWT error" });
    return res.status(401).json({ message: "Invalid or expired access token" });
  }
}
export const allow = (...roles: Role[]) => (req: AuthRequest, res: Response, next: NextFunction) => !req.user || !roles.includes(req.user.role) ? res.status(403).json({ message: "Insufficient permissions" }) : next();
