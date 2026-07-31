import dotenv from "dotenv";
import { copyFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const sourceDirectory = dirname(fileURLToPath(import.meta.url));
const serverDirectory = resolve(sourceDirectory, "..");
const projectDirectory = resolve(serverDirectory, "..");
const serverEnvPath = resolve(serverDirectory, ".env");
const rootEnvPath = resolve(projectDirectory, ".env");
const clientEnvPath = resolve(projectDirectory, "client", ".env");

console.info("Loading environment...");
if (!existsSync(serverEnvPath) && !existsSync(rootEnvPath) && existsSync(clientEnvPath)) {
  copyFileSync(clientEnvPath, serverEnvPath);
  console.info(`Copied client environment to ${serverEnvPath} without modifying the original.`);
}

const searchedEnvPaths = [serverEnvPath, rootEnvPath, clientEnvPath];
const loadedEnvFiles: string[] = [];
for (const path of [serverEnvPath, rootEnvPath]) {
  if (existsSync(path)) {
    dotenv.config({ path, override: false });
    loadedEnvFiles.push(path);
  }
}

export const env = {
  DATABASE_URL: process.env.DATABASE_URL?.trim() ?? "",
  JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET?.trim() ?? "",
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET?.trim() ?? "",
  CLIENT_ORIGIN: process.env.CLIENT_ORIGIN?.trim() || "http://localhost:5173",
  PORT: Number(process.env.PORT) || 4000,
  NODE_ENV: process.env.NODE_ENV === "production" ? "production" : process.env.NODE_ENV === "test" ? "test" : "development"
} as const;

export const missingEnvironmentKeys = [
  !env.DATABASE_URL && "DATABASE_URL",
  !env.JWT_ACCESS_SECRET && "JWT_ACCESS_SECRET",
  !env.JWT_REFRESH_SECRET && "JWT_REFRESH_SECRET"
].filter(Boolean) as string[];

export function environmentDiagnostic() {
  return missingEnvironmentKeys.length
    ? `Missing ${missingEnvironmentKeys.join(", ")}. Searched: ${searchedEnvPaths.join(" | ")}`
    : undefined;
}

export const environmentSummary = {
  loadedEnvFiles: loadedEnvFiles.length ? loadedEnvFiles : ["none"],
  searchedEnvPaths,
  nodeEnv: env.NODE_ENV,
  port: env.PORT,
  clientOrigin: env.CLIENT_ORIGIN,
  databaseLoaded: Boolean(env.DATABASE_URL),
  accessJwtLoaded: Boolean(env.JWT_ACCESS_SECRET),
  refreshJwtLoaded: Boolean(env.JWT_REFRESH_SECRET)
};
