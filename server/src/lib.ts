import { PrismaClient, Role } from "@prisma/client";
import bcrypt from "bcrypt";
import { env, environmentDiagnostic } from "./config.js";
import winston from "winston";

export const logger = winston.createLogger({ level: env.NODE_ENV === "production" ? "info" : "debug", format: winston.format.combine(winston.format.timestamp(), winston.format.json()), transports: [new winston.transports.Console()] });
// Explicitly use the DATABASE_URL that config loaded from the server environment.
export const prisma = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } }, log: env.NODE_ENV === "development" ? ["warn", "error"] : ["error"] });

function databaseConfigurationError(): string | undefined {
  if (!env.DATABASE_URL) return environmentDiagnostic();
  try {
    const url = new URL(env.DATABASE_URL);
    if (url.protocol !== "mongodb:" && url.protocol !== "mongodb+srv:") return "DATABASE_URL must start with mongodb:// or mongodb+srv://.";
    if (!url.hostname) return "DATABASE_URL is missing the MongoDB host.";
    if (url.protocol === "mongodb+srv:" && url.hostname === "cluster.mongodb.net") return "DATABASE_URL uses the placeholder host cluster.mongodb.net. Replace it with the full Atlas hostname from MongoDB Atlas (for example, cluster0.xxxxx.mongodb.net).";
    if (!url.pathname || url.pathname === "/") return "DATABASE_URL is missing the database name (for example, /foodflow).";
    if (!url.username) return "DATABASE_URL is missing the MongoDB username.";
    if (!url.password) return "DATABASE_URL is missing the MongoDB password.";
  } catch {
    return "DATABASE_URL is not a valid MongoDB connection URI.";
  }
}

function databaseErrorDetails(error: unknown) {
  const prismaError = error as { code?: string };
  const code = prismaError.code;
  const message = error instanceof Error ? error.message : "Unknown database error";
  const category = code === "P1000" ? "authentication failed" : code === "P1001" ? "server unreachable" : code === "P1011" ? "TLS connection failed" : /ENOTFOUND|querySrv|DNS/i.test(message) ? "DNS lookup failed" : /timed? out|ETIMEDOUT/i.test(message) ? "connection timed out" : "connection failed";
  return { category, code, reason: message };
}

export async function connectDatabase(retries = 3): Promise<void> {
  const configurationError = databaseConfigurationError();
  if (configurationError) {
    logger.error("MongoDB configuration error", { reason: configurationError });
    throw new Error(configurationError);
  }

  let lastError: unknown;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      await prisma.$connect();
      await prisma.$runCommandRaw({ ping: 1 });
      logger.info("\u2713 MongoDB Connected", { attempt });
      return;
    } catch (error) {
      lastError = error;
      logger.error("MongoDB connection attempt failed", { attempt, retries, ...databaseErrorDetails(error) });
      await prisma.$disconnect().catch(() => undefined);
      if (attempt < retries) await new Promise(resolve => setTimeout(resolve, attempt * 1000));
    }
  }

  logger.error("MongoDB connection failed after all retry attempts", { retries, ...databaseErrorDetails(lastError) });
  throw lastError instanceof Error ? lastError : new Error("MongoDB connection failed after all retry attempts.");
}

export async function ensureAdminUser(): Promise<void> {
  const admin = await prisma.user.findFirst({ where: { role: Role.ADMIN } });
  if (admin) { logger.info("Administrator account already exists", { userId: admin.id }); return; }
  const passwordHash = await bcrypt.hash("Admin@123", 12);
  await prisma.user.create({ data: { name: "Administrator", email: "admin@foodflow.local", passwordHash, role: Role.ADMIN, active: true } });
  logger.info("Administrator account created", { email: "admin@foodflow.local" });
}

export async function ensureCashierUser(): Promise<void> {
  const cashier = await prisma.user.findUnique({ where: { email: "cashier@foodflow.local" } });
  if (cashier) { logger.info("Cashier account already exists", { userId: cashier.id }); return; }
  const passwordHash = await bcrypt.hash("Cashier@123", 12);
  await prisma.user.create({ data: { name: "Cashier", email: "cashier@foodflow.local", passwordHash, role: Role.CASHIER, active: true } });
  logger.info("Cashier account created", { email: "cashier@foodflow.local" });
}

export async function ensureDefaultUsers(): Promise<void> {
  await ensureAdminUser();
  await ensureCashierUser();
}
