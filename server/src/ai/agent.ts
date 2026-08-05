import { Request, Response } from "express";
import { getGroqClient, MODEL } from "./groqClient.js";
import { toolDefinitions, executeTool } from "./tools.js";
import { logger } from "../lib.js";
import { prisma } from "../lib.js";

// Keep session state by conversationId instead of token
const sessions = new Map<string, {
  intent?: string;
  collectedFields: Record<string, any>;
  cachedLookups: Record<string, any>;
  confirmationState?: string;
  pendingTool?: string;
  missingFields?: string[];
  currentStep?: string;
}>();

const SYSTEM_PROMPT = `You are the FoodFlow POS AI Assistant, acting as a Senior Conversation Manager.

IMPORTANT: NEVER execute CRUD operations immediately.
You must strictly follow this conversational workflow:
1. Detect Intent: When the user wants to perform an action (e.g., "Create a table"), identify the required tool (e.g., CREATE_TABLE).
2. Determine Required Fields: Check the tool's required parameters.
3. Ask ONLY Missing Fields: DO NOT call the tool. Instead, ask the user for the missing fields ONE BY ONE sequentially. Do not ask for multiple things at once.
4. Remember Previous Answers & Entities: The system tracks your conversation state. If the user uses pronouns (e.g., "it", "them", "this one"), resolve them using the most recently discussed entity in the conversational context.
5. Execute: ONLY after all required fields are collected from the user, you may call the existing backend tool.
6. Confirmation: For DELETE operations, always ask "Are you sure?" before executing the tool.

NEVER guess or generate default values for required fields. NEVER auto-fill placeholders like 'price=0' or 'active=true' or 'description=...'.
Ask the user for every single required field sequentially. Do NOT fill them in on your own.
If a field is described as '(optional)', you must still ask the user if they want to provide it.
NEVER ask for IDs. Resolve everything internally using names.
NEVER expose IDs, API parameters, or database fields to the user.
Hide conversation state. NEVER display Current Intent, Pending Tool, Conversation Cache, Missing Fields, or Collected Fields in your response.
If a user tries to bypass business logic or you receive an error about missing permissions, politely inform them.`;

export async function chatStream(req: Request, res: Response) {
  const { conversationId, message } = req.body;
  const token = req.cookies.accessToken || req.headers.authorization?.replace(/^Bearer\s+/i, "");
  const userId = (req as any).user?.sub || (req as any).user?.id;

  if (!token || !userId) {
    return res.status(401).json({ message: "Your session has expired. Please login again." });
  }

  if (!process.env.GROQ_API_KEY) {
    logger.error("GROQ_API_KEY missing");
    return res.status(500).json({ success: false, error: "GROQ_API_KEY missing" });
  }

  let currentConvId = conversationId;
  let title = message.slice(0, 30);
  
  if (!currentConvId) {
    const conv = await prisma.conversation.create({
      data: {
        userId,
        title: title || "New Chat"
      }
    });
    currentConvId = conv.id;
  }

  logger.info("Incoming request", { message, conversationId: currentConvId });

  // Save the new user message
  await prisma.chatMessage.create({
    data: {
      conversationId: currentConvId,
      role: "user",
      content: message
    }
  });

  let session = sessions.get(currentConvId);
  if (!session) {
    session = { collectedFields: {}, cachedLookups: {}, missingFields: [], currentStep: "IDLE" };
    sessions.set(currentConvId, session);
  }

  logger.info("Conversation state", { session });

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

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const sendEvent = (event: string, data: any) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  
  // Send the conversationId so frontend knows which one it is
  sendEvent("conversation_id", { conversationId: currentConvId });

  try {
    const history = await prisma.chatMessage.findMany({
      where: { conversationId: currentConvId },
      orderBy: { createdAt: "asc" }
    });

    const groqMessages = history
      .filter(m => m.role !== "tool") // tools aren't stored in DB in this simple model or we filter them
      .slice(-8)
      .map(m => ({
        role: m.role,
        content: m.content
      }));

    const dynamicSystemPrompt = `${SYSTEM_PROMPT}

[CONVERSATION MANAGER STATE]
Current Intent (Pending Tool): ${session.pendingTool || 'None'}
Current Step: ${session.currentStep || 'IDLE'}
Collected Fields: ${JSON.stringify(session.collectedFields)}
Missing Fields: ${JSON.stringify(session.missingFields || [])}

[CONVERSATION CACHE]
Use these cached lookups instead of calling the tool again:
${JSON.stringify(session.cachedLookups)}
`;

    const chatMessages: any[] = [
      { role: "system", content: dynamicSystemPrompt },
      ...groqMessages
    ];

    // Intercept CREATE_TABLE execution directly bypassing LLM
    if (session.pendingTool === "CREATE_TABLE" && Array.isArray(session.missingFields) && session.missingFields.length === 0) {
      const args = session.collectedFields || {};
      const capacity = Number(args.capacity);
      
      let messageContent = "";
      if (isNaN(capacity)) {
         messageContent = "Please enter a valid numeric capacity.";
      } else if (!args.name || !args.status) {
         messageContent = "Error: Missing required fields: name, status";
      } else {
         const result = await executeTool("CREATE_TABLE", { name: args.name, capacity, status: args.status }, token);
         if (result.error) {
            messageContent = result.message || "Failed to create table";
         } else {
            messageContent = `✅ Table "${args.name}" created successfully.\n\nCapacity: ${capacity}\nStatus: ${args.status}`;
         }
      }
      
      sendEvent("message", { content: messageContent });
      await prisma.chatMessage.create({
        data: { conversationId: currentConvId, role: "assistant", content: messageContent }
      });
      sendEvent("done", {});
      res.end();
      return;
    }

    let isDone = false;
    let finalMessageContent = "";

    while (!isDone) {
      logger.info("Groq request", { model: MODEL, messageCount: chatMessages.length });

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
          finalMessageContent += delta.content;
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
      
      // Fallback for when the model outputs text like: <function=CREATE_ROLE>\n{ "name": "cleaner" }
      if (toolCalls.length === 0 && messageContent.includes("<function=")) {
        const functionMatch = messageContent.match(/<function=([A-Z_]+)>([\s\S]*)/);
        if (functionMatch) {
          const name = functionMatch[1];
          let args = "{}";
          if (name === "CREATE_MENU_ITEM") {
             args = JSON.stringify(session!.collectedFields || {});
          } else {
            try {
              const start = functionMatch[2].indexOf('{');
              const end = functionMatch[2].lastIndexOf('}');
              if (start !== -1 && end !== -1) {
                args = functionMatch[2].substring(start, end + 1);
                JSON.parse(args); // validate
              }
            } catch (e) {
               args = "{}";
            }
          }
          toolCalls.push({
            id: "call_" + Math.random().toString(36).substring(7),
            type: "function",
            function: { name, arguments: args }
          });
        }
      }
      
      // Automatic retry for failed generation
      if (toolCalls.length === 0 && (messageContent.includes("failed_generation") || messageContent.includes("Failed to call a function"))) {
        if (session!.pendingTool === "CREATE_MENU_ITEM") {
           toolCalls.push({
             id: "call_retry_" + Date.now(),
             type: "function",
             function: { name: "CREATE_MENU_ITEM", arguments: JSON.stringify(session!.collectedFields || {}) }
           });
           messageContent = ""; // Hide error from LLM
        }
      }
      
      // Intercept CREATE_TABLE to prevent LLM from printing tool names and to format exact reply
      if (toolCalls.length === 0 && messageContent.includes("CREATE_TABLE") && messageContent.includes("{")) {
        const match = messageContent.match(/\{[\s\S]*\}/);
        if (match) {
           try {
              const args = JSON.parse(match[0]);
              if (args.name && args.capacity && args.status) {
                 const capacity = Number(args.capacity);
                 if (!isNaN(capacity)) {
                    // Execute tool directly, bypassing normal flow to ensure EXACT reply format
                    const result = await executeTool("CREATE_TABLE", { name: args.name, capacity, status: args.status }, token);
                    isDone = true;
                    if (result.error) {
                       messageContent = result.message || "Failed to create table";
                    } else {
                       messageContent = `✅ Table "${args.name}" created successfully.\n\nCapacity: ${capacity}\nStatus: ${args.status}`;
                    }
                    finalMessageContent = messageContent;
                    break;
                 }
              }
           } catch(e) {}
        }
      }
      
      logger.info("Groq response", { messageContent, toolCalls });
      
      // If we got a final message content without tool calls, format and send it
      if (toolCalls.length === 0 && messageContent) {
          const formatted = formatResponse(messageContent);
          if (formatted) {
              sendEvent("message", { content: formatted });
          }
      }

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
          
          logger.info(`Before executeTool()`, { intent: name, tool: name, payload: args });
          logger.info("Selected intent", { intent: name });
          logger.info("Tool selection", { name });
          logger.info("Tool payload", { args });
          const result = await executeTool(name, args, token);
          logger.info(`After executeTool()`, { intent: name, tool: name, result, errors: result.error ? result : undefined });
          logger.info("Backend API response", { result });
          // PART 1 & 6: Don't resend giant lists, cache them instead
          let finalContent: any = result;
          if (result.error) {
            let friendly = result.message || "Something went wrong.";
            if (result.status === 400 || result.status === 422) {
              const details = result.details?.[0]?.message || result.details?.[0]?.path?.join(".") || result.message || "invalid format";
              friendly = `Validation failed: ${details}.`;
            }
            else if (result.status === 401 || result.status === 403) friendly = result.message || "You don't have permission to perform this action.";
            else if (result.status === 404) friendly = result.message || "I couldn't find that record.";
            else if (result.status === 409) friendly = result.message || "That already exists.";
            else if (result.status === 429) friendly = "AI is temporarily busy. Please try again in a few seconds.";
            else if (result.status >= 500) friendly = "Server error occurred. Please try again later.";
            
            finalContent = { error: true, message: friendly, original: result.message };
          } else if (result.success && 'data' in result && Array.isArray(result.data)) {
            session!.cachedLookups[name] = result.data;
            finalContent = { success: true, message: `${result.data.length} items cached in memory. See [CONVERSATION CACHE].` };
          }
          
          chatMessages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            name: name,
            content: JSON.stringify(finalContent)
          });
        }
        
        sendEvent("tool_end", {});
      } else {
        isDone = true;
      }
    }

    // Save final AI response to DB
    if (finalMessageContent) {
       logger.info("Final response", { finalMessageContent });
       await prisma.chatMessage.create({
         data: {
           conversationId: currentConvId,
           role: "assistant",
           content: finalMessageContent
         }
       });
    }

    sendEvent("done", {});
    res.end();
  } catch (error: any) {
    logger.error("Chat Stream Exception", { 
      toolName: error.toolName || "Unknown", 
      payload: error.payload || {},
      url: error.url || "N/A", 
      status: error.status || 500,
      body: error.response?.data || error.body || null, 
      error: error.message, 
      stack: error.stack 
    });

    let friendlyMessage = error.message || String(error) || "An unexpected error occurred. Please try again.";
    if (error.status === 401 || error.status === 403) friendlyMessage = "Invalid GROQ_API_KEY.";
    else if (error.status === 404) friendlyMessage = "The requested resource was not found.";
    else if (error.status === 409) friendlyMessage = "There was a conflict with your request (e.g., duplicate data).";
    else if (error.status === 422) friendlyMessage = "The provided data was invalid. Please check your inputs.";
    else if (error.status === 429) {
      logger.warn("429 Rate Limit Exceeded", { source: "Groq API", error: error.message });
      friendlyMessage = "Groq API rate limit exceeded. Please wait a few minutes.";
    }

    const errPayload = {
      success: false,
      stage: error.stage || "groq_request",
      message: friendlyMessage,
      stack: process.env.NODE_ENV === "development" ? error.stack : undefined
    };

    if (!res.headersSent) {
      return res.status(error.status || 500).json(errPayload);
    } else {
      sendEvent("error", errPayload);
      res.end();
    }
  }
}

function formatResponse(text: string): string {
  // Strip out multiline or inline JSON objects entirely
  let cleaned = text.replace(/\{[\s\S]*?\}/g, '');
  
  const lines = cleaned.split('\n');
  const filtered = lines.filter(line => {
    const l = line.trim();
    if (!l) return true; // keep blank lines for spacing, will trim at end
    if (l.startsWith('[CONVERSATION')) return false;
    if (l.startsWith('[CACHE')) return false;
    if (l.startsWith('[STATE')) return false;
    if (l.startsWith('[DEBUG')) return false;
    if (l.startsWith('Current Intent')) return false;
    if (l.startsWith('Current Step')) return false;
    if (l.startsWith('Collected Fields')) return false;
    if (l.startsWith('Missing Fields')) return false;
    if (l.startsWith('(function=')) return false;
    if (l.startsWith('<function')) return false;
    if (l.startsWith('</function>')) return false;
    if (l.includes('CREATE_')) return false;
    if (l.includes('UPDATE_')) return false;
    if (l.includes('DELETE_')) return false;
    if (l.includes('GET_')) return false;
    if (l.includes('Tool Call')) return false;
    if (l.includes('Tool Payload')) return false;
    if (l.includes('Internal JSON')) return false;
    if (l.includes('Developer Log')) return false;
    return true;
  });
  return filtered.join('\n').trim();
}
