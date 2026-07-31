import http from "http";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import { Server } from "socket.io";
import swaggerUi from "swagger-ui-express";
import multer from "multer";
import routes from "./routes.js";
import { env, environmentDiagnostic, environmentSummary, missingEnvironmentKeys } from "./config.js";
import { connectDatabase, ensureDefaultUsers, ensureSparseMenuItemUniqueIndexes, logger } from "./lib.js";
import { setIo } from "./realtime.js";

const allowedOrigins = ["http://localhost:5173", "http://localhost:5174", "http://localhost:5175"];
const isAllowedOrigin = (origin?: string) => !origin || allowedOrigins.includes(origin) || origin === env.CLIENT_ORIGIN;
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: allowedOrigins, credentials: true } });
setIo(io);
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(compression());
app.use(cors({ origin: (origin, callback) => callback(null, isAllowedOrigin(origin)), credentials: true }));
app.use(rateLimit({ windowMs: 15 * 60e3, max: 500 }));
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());
app.use("/uploads", express.static("uploads"));
const upload = multer({ dest: "uploads/", limits: { fileSize: 5 * 1024 * 1024 } });
app.post("/api/uploads", upload.single("file"), (req, res) => !req.file ? res.status(400).json({ message: "File required" }) : res.status(201).json({ data: { url: `/uploads/${req.file.filename}` } }));
app.get("/health", (_req, res) => res.status(missingEnvironmentKeys.length ? 503 : 200).json({ status: missingEnvironmentKeys.length ? "configuration_required" : "ok", diagnostic: environmentDiagnostic() }));
app.use("/api", routes);
app.use("/docs", swaggerUi.serve, swaggerUi.setup({ openapi: "3.0.0", info: { title: "FoodFlow POS API", version: "1.0.0" }, paths: { "/api/auth/login": { post: { summary: "Authenticate user" } } } }));
app.use((error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => { logger.error("Unhandled API error", { message: error.message, stack: error.stack }); if (error.name === "ZodError") return res.status(422).json({ message: "Validation failed", errors: error.issues }); if (error.code === "P2002") return res.status(409).json({ message: "A record with that value already exists" }); return res.status(error.status || 500).json({ message: error.message || "Internal server error" }); });
io.on("connection", socket => logger.info("Socket.io client connected", { id: socket.id }));

async function start() {
  logger.info("\u2713 Environment Loaded", environmentSummary);
  if (missingEnvironmentKeys.length) throw new Error(environmentDiagnostic());
  logger.info("\u2713 Prisma Client Loaded");
  logger.info("\u2713 Connecting to MongoDB...");
  await connectDatabase(3);
  await ensureSparseMenuItemUniqueIndexes();
  logger.info("Creating default users if missing...");
  await ensureDefaultUsers();
  logger.info("Socket.io ready");
  server.listen(env.PORT, () => logger.info(`\u2713 Server Running on Port ${env.PORT}`));
}

start().catch(error => logger.error("Server startup failed", { code: (error as { code?: string })?.code, reason: error instanceof Error ? error.message : "Unknown error" }));
