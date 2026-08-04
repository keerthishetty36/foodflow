import { Request, Response } from "express";
import { prisma } from "../lib.js";

// GET /api/ai/conversations
export async function getConversations(req: Request, res: Response) {
  try {
    const userId = (req as any).user.sub || (req as any).user.id;
    const conversations = await prisma.conversation.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        title: true,
        createdAt: true,
        updatedAt: true
      }
    });
    res.json({ success: true, data: conversations });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching conversations", error });
  }
}

// GET /api/ai/conversations/:id
export async function getConversationHistory(req: Request, res: Response) {
  try {
    const userId = (req as any).user.sub || (req as any).user.id;
    const id = req.params.id as string;

    const conversation = await prisma.conversation.findUnique({
      where: { id },
      include: {
        messages: {
          orderBy: { createdAt: "asc" }
        }
      }
    });

    if (!conversation) {
      return res.status(404).json({ success: false, message: "Conversation not found" });
    }

    if (conversation.userId !== userId) {
      return res.status(403).json({ success: false, message: "Unauthorized" });
    }

    res.json({ success: true, data: conversation });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching conversation history", error });
  }
}

// DELETE /api/ai/conversations/:id
export async function deleteConversation(req: Request, res: Response) {
  try {
    const userId = (req as any).user.sub || (req as any).user.id;
    const id = req.params.id as string;

    const conversation = await prisma.conversation.findUnique({ where: { id } });
    if (!conversation) {
      return res.status(404).json({ success: false, message: "Conversation not found" });
    }
    if (conversation.userId !== userId) {
      return res.status(403).json({ success: false, message: "Unauthorized" });
    }

    await prisma.conversation.delete({ where: { id } });
    res.json({ success: true, message: "Conversation deleted" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error deleting conversation", error });
  }
}

// DELETE /api/ai/conversations
export async function clearAllConversations(req: Request, res: Response) {
  try {
    const userId = (req as any).user.sub || (req as any).user.id;
    await prisma.conversation.deleteMany({
      where: { userId }
    });
    res.json({ success: true, message: "All conversations cleared" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error clearing conversations", error });
  }
}
