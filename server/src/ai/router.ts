import { Router } from "express";
import { authenticate } from "../auth.js";
import { chatStream } from "./agent.js";
import { asyncHandler } from "../utils.js";

const router = Router();

// Endpoint for the AI assistant chat
router.post("/chat", authenticate, asyncHandler(chatStream));

export default router;
