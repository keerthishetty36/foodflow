import { Request, Response } from "express";
import { getGroqClient, MODEL } from "./groqClient.js";
import { toolDefinitions, executeTool } from "./tools.js";
import { logger } from "../lib.js";

const SYSTEM_PROMPT = `You are the FoodFlow POS AI Assistant.
Your goal is to help restaurant managers, cashiers, and kitchen staff manage the restaurant.
You have access to tools that can fetch data and perform operations (like creating users, menu items, or orders).

IMPORTANT RULES:
1. ALWAYS use the provided tools to interact with the POS system. DO NOT make up data.
2. If a user asks to perform an action (e.g., "Create a user"), but you don't have all the required information, ASK them conversationally for the missing fields before calling the tool. Do not ask for everything at once if it feels robotic.
3. If a tool fails, explain the error nicely to the user.
4. Format reports nicely using Markdown. Use tables for lists of items (e.g., inventory, users).
5. Never expose API keys, database details, or raw stack traces.
6. Before deleting ANYTHING, you must ask the user for explicit confirmation (e.g., "Are you sure you want to delete this menu item?").

You are running inside a secure backend. The tools you call will execute with the permissions of the currently logged-in user. If a tool returns a permission error, inform the user they don't have access.
`;

export async function chatStream(req: Request, res: Response) {
  const { messages } = req.body;
  const token = req.cookies.accessToken;

  if (!token) {
    return res.status(401).json({ message: "Authentication required" });
  }

  if (!process.env.GROQ_API_KEY) {
    logger.error("GROQ_API_KEY missing");
    return res.status(500).json({ success: false, error: "GROQ_API_KEY missing" });
  }

  let groq;
  try {
    groq = getGroqClient();
  } catch (error: any) {
    console.error("AI Client Initialization error:", error);
    return res.status(500).json({
      success: false,
      message: error.message,
      status: error.status,
      code: error.code,
      type: error.type,
      stack: process.env.NODE_ENV === "development" ? error.stack : undefined
    });
  }

  try {
    const models = await groq.models.list();
    const modelExists = models.data.find((m: any) => m.id === MODEL);
    if (!modelExists) {
      throw new Error(`Model ${MODEL} not found`);
    }
  } catch (error: any) {
    console.error("Model verification failed:", error);
    return res.status(500).json({
      success: false,
      message: error.message,
      status: error.status,
      code: error.code,
      type: error.type,
      stack: process.env.NODE_ENV === "development" ? error.stack : undefined
    });
  }

  // Setup SSE
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const sendEvent = (event: string, data: any) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const groqMessages = messages.map((message: any) => ({
      role: message.role,
      content: message.content
    }));

    const chatMessages = [
      { role: "system", content: SYSTEM_PROMPT },
      ...groqMessages
    ];

    let isDone = false;

    while (!isDone) {
      console.log("GROQ_API_KEY loaded:", !!process.env.GROQ_API_KEY);
      console.log("Model:", MODEL);
      console.log("Messages:", chatMessages);

      const stream = await groq.chat.completions.create({
        model: MODEL,
        messages: chatMessages,
        tools: toolDefinitions,
        tool_choice: "auto",
        stream: true,
      });

      let toolCalls: any[] = [];
      let messageContent = "";

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;
        
        if (delta?.content) {
          messageContent += delta.content;
          sendEvent("message", { content: delta.content });
        }

        if (delta?.tool_calls) {
          for (const toolCall of delta.tool_calls) {
            const index = toolCall.index;
            if (!toolCalls[index]) {
              toolCalls[index] = {
                id: toolCall.id,
                type: "function",
                function: { name: toolCall.function?.name || "", arguments: "" }
              };
            }
            if (toolCall.function?.arguments) {
              toolCalls[index].function.arguments += toolCall.function.arguments;
            }
          }
        }
      }
      
      logger.info("Response received");

      chatMessages.push({
        role: "assistant",
        content: messageContent || null,
        tool_calls: toolCalls.length > 0 ? toolCalls : undefined
      });

      if (toolCalls.length > 0) {
        sendEvent("tool_start", { count: toolCalls.length });
        
        for (const toolCall of toolCalls) {
          const name = toolCall.function.name;
          const args = JSON.parse(toolCall.function.arguments || "{}");
          
          logger.info(`AI executing tool: ${name}`);
          const result = await executeTool(name, args, token);
          
          chatMessages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            name: name,
            content: JSON.stringify(result)
          });
        }
        
        sendEvent("tool_end", {});
        // Loop will continue and send the tool result back to Groq
      } else {
        isDone = true;
      }
    }

    sendEvent("done", {});
    res.end();
  } catch (error: any) {
    console.error("error.message:", error.message);
    console.error("error.status:", error.status);
    console.error("error.code:", error.code);
    console.error("error.type:", error.type);
    console.error("error.response:", error.response);
    console.error("error.stack:", error.stack);

    // Send actual error safely back to frontend instead of generic string
    sendEvent("error", { 
      message: error.message,
      status: error.status,
      code: error.code,
      type: error.type 
    });
    res.end();
  }
}
