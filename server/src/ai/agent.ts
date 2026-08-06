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

7. Field Collection: When a value is collected, add it to your Collected Fields state block. The backend will persist this. The next question must always be selected from (Required Fields - Collected Fields). Never recompute missing fields from scratch. Never overwrite collected values unless the user explicitly edits them.
8. Execution: Immediately before executing CREATE_MENU_ITEM, validate name, categoryName, costPrice, price, vegType. If all exist, execute CREATE_MENU_ITEM. Do not restart the conversation. Do not ask again.
9. Tool Response Handling: AFTER CREATE / UPDATE / DELETE, always wait for the backend response. Never assume success. Never generate fake success messages. IF success, return exactly "✅ Category created successfully." or "✅ Menu item created successfully." (or updated/deleted). IF failed, return ONLY the backend error message. Never return success before the backend confirms creation.
10. Post-Success Refresh: IMMEDIATELY after a successful CREATE / UPDATE / DELETE operation for a category, you MUST call GET_CATEGORIES to refresh the frontend. IMMEDIATELY after a successful CREATE / UPDATE / DELETE operation for a menu item, you MUST call GET_MENU_ITEMS to refresh the frontend.

11. Menu & Category Specifics:
- CATEGORY LOOKUP: Do NOT use hardcoded categories, cached categories, or AI memory. ALWAYS call ONLY the existing GET_CATEGORIES API. Resolve categoryName to categoryId before calling CREATE_MENU_ITEM.
- NUMBER CONVERSION: You MUST convert price and costPrice to Numbers before calling the backend. Never send strings like "50", always send 50.
- MENU ITEM CREATE: Collect ONLY name, categoryName, costPrice, price, vegType. Do NOT ask unnecessary questions.
- CATEGORY CREATE: Collect ONLY name, description (optional), active. If user skips active, default to true.
- CATEGORY UPDATE: Use GET_CATEGORIES first. Resolve category by name. Collect only fields being updated. Call ONLY UPDATE_CATEGORY. Refresh categories using GET_CATEGORIES.
- CATEGORY DELETE: Use GET_CATEGORIES first. Resolve category id. Ask confirmation. Call DELETE_CATEGORY. Refresh GET_CATEGORIES.
- BOOLEAN CONVERSION: When collecting the 'active' field (e.g. Yes/No/Active/Inactive), you MUST internally convert it to a native boolean. Yes -> true, No -> false, Active -> true, Inactive -> false. Never send strings.
- VALIDATION: Before calling CREATE_CATEGORY or UPDATE_CATEGORY, you MUST verify typeof payload.active === "boolean". Never call the tool if active is a string.
- UPDATE / DELETE MENU ITEMS: Before updating or deleting a Menu Item, load menu items using GET_MENU_ITEMS. Find the entity by name. For update, ask only for fields the user wants to change. For delete, ask for confirmation.
- TOOL EXECUTION: Never generate fake tool names. Never invent payloads. Never invent IDs (category IDs, menu IDs). Only use backend responses.
12. State Management & Intent Locking:
- Once an operation like CREATE_MENU_ITEM, CREATE_CATEGORY, UPDATE_MENU_ITEM, UPDATE_CATEGORY, DELETE_MENU_ITEM, DELETE_CATEGORY, or CREATE_ORDER starts, you MUST lock CurrentIntent to that operation until it completes or the user explicitly cancels.
- NEVER perform intent detection or ask "What does this relate to?" while a CRUD flow is active.
- Always map the user's reply directly to the current missing field or the current step in the order creation process.
- For confirmation replies (like "Yes", "No", "A", "B", "1", "2"), interpret them strictly according to the CURRENT STEP. Never switch intents (e.g. do not switch to DELETE_ORDER just because the user said "No").

13. Order Creation Flow:
- Order creation is handled by the application conversation manager. Never call an order lookup tool unless it is registered in the tools supplied with the request.
- Menu validation must use a live GET_MENU_ITEMS tool response only when that registered tool is available.
- If valid, ask for the quantity.
- After collecting an item, ask "Would you like to add another item? (Yes/No)". If Yes, collect another menu item. If No, execute CREATE_ORDER and return ONLY "✅ Order created successfully."

14. Output Format Constraints:
- NEVER display HTML.
- NEVER display markdown tables.
- NEVER list missing fields or display validation tables.
- NEVER display Developer logs, JSON, function tags, or Raw API payloads.
- Every missing field must be asked as a single, simple conversational question (e.g., "What table would you like to create the order for?").

15. Table Update Flow:
- When the user asks to update a table, ask "Which table would you like to update?".
- Call ONLY the existing GET_TABLE (or LIST_TABLES) API to find the exact table by name. If not found, return 'Table "<name>" was not found.' and stop. Do NOT overwrite the name or invent a new name.
- If found, ask "What would you like to update?" with options: Name, Capacity, Status.
- After the user selects a field, you must ONLY collect that specific selected field.
- Exactly one selected field -> Exactly one follow-up question -> Execute UPDATE_TABLE.
- Do NOT ask for fields that were never requested. Perform partial updates. Never require all editable fields.
- If Name: collect ONLY newName.
- If Capacity: collect ONLY capacity and convert to Number.
- If Status: collect ONLY status.
- Immediately execute UPDATE_TABLE with only the changed field. Never send unchanged fields. Wait for success, refresh GET_TABLE, and return ONLY "✅ Table updated successfully."
- Never reuse stale values from previous conversations. Never overwrite the original table name.

16. Role Deletion Flow:
- When the user asks to delete a role, call ONLY the existing GET_ROLES API. Find the role by name.
- Store BOTH roleId and roleName inside conversation state. Never discard them.
- Ask "Are you sure you want to delete '<roleName>'?".
- Upon confirmation, execute ONLY the DELETE_ROLE tool, passing ONLY { "roleId": "<resolved id>" }.
- Never pass roleName. Never ask for roleId. Never expose IDs. Never fabricate IDs.
- Wait for backend response. If success, refresh using GET_ROLES and return ONLY "✅ Role deleted successfully." If it fails, return ONLY the backend error.
- During confirmation, preserve selectedRoleId, selectedRoleName, and pendingOperation=DELETE_ROLE. Do not clear these values until DELETE_ROLE finishes.

17. User Creation Flow (Missing Role Fallback):
- If the user provides a role that does not exist during CREATE_USER, the backend will return a 404 error asking if you want to create it.
- Ask the user exactly: 'The role "<roleName>" doesn't exist. Would you like to create it? (Yes/No)'
- If the user says Yes, DO NOT display any <function> tags, JSON, tool payloads, or developer logs.
- Internally execute ONLY the CREATE_ROLE tool. Pass the role name, and an empty array [] for permissions. Wait for the backend response.
- If CREATE_ROLE succeeds, immediately refresh roles using the GET_ROLES API to resolve the new roleId.
- Automatically continue the original Create User flow without asking for name, email, password, or role again. Reuse the already collected values from your state.
- Immediately execute CREATE_USER using the newly created role.
- Reply ONLY: "✅ Role created successfully.\n✅ User created successfully."
- Never lose collected fields. Keep name, email, password, and role until CREATE_USER completes. Never restart the conversation.

NEVER guess or generate default values for required fields. NEVER auto-fill placeholders like 'price=0' or 'active=true' or 'description=...'.
Ask the user for every single required field sequentially. Do NOT fill them in on your own.
If a field is described as '(optional)', you must still ask the user if they want to provide it.
NEVER ask for IDs. Resolve everything internally using names.
NEVER expose IDs, API parameters, or database fields to the user.
Hide conversation state. NEVER display Current Intent, Pending Tool, Conversation Cache, Missing Fields, or Collected Fields in your response.
If a user tries to bypass business logic or you receive an error about missing permissions, politely inform them.`;

const registeredToolNames = new Set(toolDefinitions.map(tool => tool.function.name));

function normalizeOrderValue(value: unknown) {
  return String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

function editDistance(a: string, b: string) {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let row = 1; row <= a.length; row++) {
    let diagonal = previous[0];
    previous[0] = row;
    for (let column = 1; column <= b.length; column++) {
      const saved = previous[column];
      previous[column] = Math.min(previous[column] + 1, previous[column - 1] + 1, diagonal + (a[row - 1] === b[column - 1] ? 0 : 1));
      diagonal = saved;
    }
  }
  return previous[b.length];
}

function resetOrderConversation(session: any) {
  session.pendingTool = undefined;
  session.currentStep = "IDLE";
  session.collectedFields = {};
}

function resetUserConversation(session: any) {
  session.pendingTool = undefined;
  session.currentStep = "IDLE";
  session.collectedFields = {};
}


function formatFriendlyError(result: any): string {
  let friendly = result.message || "Something went wrong.";
  if (result.status === 400 || result.status === 422) {
    const details = result.details?.[0]?.message || result.details?.[0]?.path?.join(".") || result.message || "invalid format";
    friendly = `Validation failed: ${details}.`;
  }
  return friendly;
}

function resetCategoryConversation(session: any) {
  session.pendingTool = undefined;
  session.currentStep = "IDLE";
  session.collectedFields = {};
}

async function handleCategoryConversation(message: string, session: any, token: string): Promise<string | null> {
  const normalizedMsg = String(message ?? "").trim();
  const startsCreate = /\b(create|add|new)\b.*\bcategory\b/i.test(normalizedMsg);
  const startsUpdate = /\b(update|edit|modify)\b.*\bcategory\b/i.test(normalizedMsg);
  const startsDelete = /\b(delete|remove)\b.*\bcategory\b/i.test(normalizedMsg);

  if (normalizedMsg.toLowerCase() === "cancel") {
    resetCategoryConversation(session);
    return "Operation cancelled.";
  }

  // Init flow
  if (!session.pendingTool) {
    if (startsCreate) {
      session.pendingTool = "CREATE_CATEGORY";
      session.currentStep = "CAT_CREATE_NAME";
      session.collectedFields = {};
      return "What is the category name?";
    } else if (startsUpdate) {
      session.pendingTool = "UPDATE_CATEGORY";
      session.currentStep = "CAT_UPDATE_SELECT";
      session.collectedFields = {};
      return "Which category would you like to update?";
    } else if (startsDelete) {
      session.pendingTool = "DELETE_CATEGORY";
      session.currentStep = "CAT_DELETE_SELECT";
      session.collectedFields = {};
      return "Which category would you like to delete?";
    }
    return null;
  }

  // Flow execution
  if (session.pendingTool === "CREATE_CATEGORY") {
    if (session.currentStep === "CAT_CREATE_NAME") {
      const name = normalizedMsg;
      if (!name) return "What is the category name?";
      session.collectedFields.name = name;
      session.currentStep = "CAT_CREATE_DESC";
      return "What is the category description? (or type 'skip' to leave blank)";
    }
    if (session.currentStep === "CAT_CREATE_DESC") {
      const desc = normalizedMsg;
      if (desc.toLowerCase() !== "skip") {
        session.collectedFields.description = desc;
      }
      session.currentStep = "CAT_CREATE_ACTIVE";
      return "Should the category be active? (Yes/No)";
    }
    if (session.currentStep === "CAT_CREATE_ACTIVE") {
      const activeStr = normalizedMsg.toLowerCase();
      let active = true;
      if (activeStr === "yes" || activeStr === "y" || activeStr === "active" || activeStr === "true") {
        active = true;
      } else if (activeStr === "no" || activeStr === "n" || activeStr === "inactive" || activeStr === "false") {
        active = false;
      } else if (activeStr !== "skip") {
        return "Should the category be active? (Yes/No)";
      }
      session.collectedFields.active = active;

      if (typeof session.collectedFields.active !== "boolean") {
        resetCategoryConversation(session);
        return "Validation failed: active must be a boolean.";
      }

      const result = await executeTool("CREATE_CATEGORY", session.collectedFields, token);
      resetCategoryConversation(session);
      if (result.error) {
        return formatFriendlyError(result);
      }
      await executeTool("GET_CATEGORIES", {}, token);
      return "✅ Category created successfully.";
    }
  }

  if (session.pendingTool === "UPDATE_CATEGORY") {
    if (session.currentStep === "CAT_UPDATE_SELECT") {
      const catName = normalizedMsg;
      const catList: any = await executeTool("GET_CATEGORIES", {}, token);
      if (catList.error) {
        resetCategoryConversation(session);
        return "Unable to load categories.";
      }
      const category = (catList.data || []).find((c: any) => normalizeOrderValue(c.name) === normalizeOrderValue(catName));
      if (!category) {
        return `I couldn't find the category '${catName}'. Which category would you like to update?`;
      }
      session.collectedFields.id = category.id || category._id;
      session.collectedFields.name = category.name;
      session.currentStep = "CAT_UPDATE_FIELD";
      return "What would you like to update? (Name, Description, Active Status)";
    }
    if (session.currentStep === "CAT_UPDATE_FIELD") {
      const field = normalizedMsg.toLowerCase();
      if (field.includes("name")) {
        session.currentStep = "CAT_UPDATE_NAME_VALUE";
        return "What is the new name?";
      } else if (field.includes("description") || field.includes("desc")) {
        session.currentStep = "CAT_UPDATE_DESC_VALUE";
        return "What is the new description?";
      } else if (field.includes("active") || field.includes("status")) {
        session.currentStep = "CAT_UPDATE_ACTIVE_VALUE";
        return "Should the category be active? (Yes/No)";
      } else {
        return "What would you like to update? (Name, Description, Active Status)";
      }
    }
    if (session.currentStep === "CAT_UPDATE_NAME_VALUE") {
      const newName = normalizedMsg;
      if (!newName) return "What is the new name?";
      const result = await executeTool("UPDATE_CATEGORY", { id: session.collectedFields.id, name: newName }, token);
      resetCategoryConversation(session);
      if (result.error) return formatFriendlyError(result);
      await executeTool("GET_CATEGORIES", {}, token);
      return "✅ Category updated successfully.";
    }
    if (session.currentStep === "CAT_UPDATE_DESC_VALUE") {
      const newDesc = normalizedMsg;
      const result = await executeTool("UPDATE_CATEGORY", { id: session.collectedFields.id, description: newDesc }, token);
      resetCategoryConversation(session);
      if (result.error) return formatFriendlyError(result);
      await executeTool("GET_CATEGORIES", {}, token);
      return "✅ Category updated successfully.";
    }
    if (session.currentStep === "CAT_UPDATE_ACTIVE_VALUE") {
      const activeStr = normalizedMsg.toLowerCase();
      let active: boolean;
      if (activeStr === "yes" || activeStr === "y" || activeStr === "active" || activeStr === "true") {
        active = true;
      } else if (activeStr === "no" || activeStr === "n" || activeStr === "inactive" || activeStr === "false") {
        active = false;
      } else {
        return "Should the category be active? (Yes/No)";
      }

      const result = await executeTool("UPDATE_CATEGORY", { id: session.collectedFields.id, active }, token);
      resetCategoryConversation(session);
      if (result.error) return formatFriendlyError(result);
      await executeTool("GET_CATEGORIES", {}, token);
      return "✅ Category updated successfully.";
    }
  }

  if (session.pendingTool === "DELETE_CATEGORY") {
    if (session.currentStep === "CAT_DELETE_SELECT") {
      const catName = normalizedMsg;
      const catList: any = await executeTool("GET_CATEGORIES", {}, token);
      if (catList.error) {
        resetCategoryConversation(session);
        return "Unable to load categories.";
      }
      const category = (catList.data || []).find((c: any) => normalizeOrderValue(c.name) === normalizeOrderValue(catName));
      if (!category) {
        return `I couldn't find the category '${catName}'. Which category would you like to delete?`;
      }
      session.collectedFields.id = category.id || category._id;
      session.collectedFields.name = category.name;
      session.currentStep = "CAT_DELETE_CONFIRM";
      return `Are you sure you want to delete the category '${category.name}'? (Yes/No)`;
    }
    if (session.currentStep === "CAT_DELETE_CONFIRM") {
      const answer = normalizedMsg.toLowerCase();
      if (answer === "yes" || answer === "y") {
        const result = await executeTool("DELETE_CATEGORY", { id: session.collectedFields.id }, token);
        resetCategoryConversation(session);
        if (result.error) return formatFriendlyError(result);
        await executeTool("GET_CATEGORIES", {}, token);
        return "✅ Category deleted successfully.";
      } else if (answer === "no" || answer === "n") {
        resetCategoryConversation(session);
        return "Operation cancelled.";
      } else {
        return `Are you sure you want to delete the category '${session.collectedFields.name}'? (Yes/No)`;
      }
    }
  }

  resetCategoryConversation(session);
  return null;
}

function resetMenuConversation(session: any) {
  session.pendingTool = undefined;
  session.currentStep = "IDLE";
  session.collectedFields = {};
}

async function handleMenuConversation(message: string, session: any, token: string): Promise<string | null> {
  const normalizedMsg = String(message ?? "").trim();
  const startsCreate = /\b(create|add|new)\b.*\b(menu item|menu)\b/i.test(normalizedMsg);
  const startsUpdate = /\b(update|edit|modify)\b.*\b(menu item|menu)\b/i.test(normalizedMsg);
  const startsDelete = /\b(delete|remove)\b.*\b(menu item|menu)\b/i.test(normalizedMsg);

  if (normalizedMsg.toLowerCase() === "cancel") {
    resetMenuConversation(session);
    return "Operation cancelled.";
  }

  // Init flow
  if (!session.pendingTool) {
    if (startsCreate) {
      session.pendingTool = "CREATE_MENU_ITEM";
      session.currentStep = "MENU_CREATE_NAME";
      session.collectedFields = {};
      return "What is the menu item name?";
    } else if (startsUpdate) {
      session.pendingTool = "UPDATE_MENU_ITEM";
      session.currentStep = "MENU_UPDATE_SELECT";
      session.collectedFields = {};
      return "Which menu item would you like to update?";
    } else if (startsDelete) {
      session.pendingTool = "DELETE_MENU_ITEM";
      session.currentStep = "MENU_DELETE_SELECT";
      session.collectedFields = {};
      return "Which menu item would you like to delete?";
    }
    return null;
  }

  // Flow execution
  if (session.pendingTool === "CREATE_MENU_ITEM") {
    if (session.currentStep === "MENU_CREATE_NAME") {
      const name = normalizedMsg;
      if (!name) return "What is the menu item name?";
      session.collectedFields.name = name;
      session.currentStep = "MENU_CREATE_CATEGORY";
      return "Which category?";
    }
    if (session.currentStep === "MENU_CREATE_CATEGORY") {
      const catName = normalizedMsg;
      const catList: any = await executeTool("GET_CATEGORIES", {}, token);
      if (catList.error) return "Unable to load categories.";
      const category = (catList.data || []).find((c: any) => normalizeOrderValue(c.name) === normalizeOrderValue(catName));
      if (!category) {
        return `I couldn't find the category '${catName}'. Please choose an existing category.`;
      }
      session.collectedFields.categoryId = category.id || category._id;
      session.currentStep = "MENU_CREATE_COST_PRICE";
      return "What is the cost price?";
    }
    if (session.currentStep === "MENU_CREATE_COST_PRICE") {
      const costPrice = Number(normalizedMsg);
      if (isNaN(costPrice) || costPrice < 0) return "What is the cost price?";
      session.collectedFields.costPrice = costPrice;
      session.currentStep = "MENU_CREATE_PRICE";
      return "What is the selling price?";
    }
    if (session.currentStep === "MENU_CREATE_PRICE") {
      const price = Number(normalizedMsg);
      if (isNaN(price) || price <= 0) return "What is the selling price?";
      session.collectedFields.price = price;
      session.currentStep = "MENU_CREATE_VEG_TYPE";
      return "Is it VEG, NON_VEG or EGG?";
    }
    if (session.currentStep === "MENU_CREATE_PRICE") {
      // Duplicate guard - handled in step
    }
    if (session.currentStep === "MENU_CREATE_VEG_TYPE") {
      const vegType = normalizedMsg.toUpperCase();
      if (!["VEG", "NON_VEG", "EGG"].includes(vegType)) return "Is it VEG, NON_VEG or EGG?";
      session.collectedFields.vegType = vegType;

      const result = await executeTool("CREATE_MENU_ITEM", session.collectedFields, token);
      resetMenuConversation(session);
      if (result.error) return formatFriendlyError(result);
      await executeTool("GET_MENU_ITEMS", {}, token);
      return "✅ Menu item created successfully.";
    }
  }

  if (session.pendingTool === "UPDATE_MENU_ITEM") {
    if (session.currentStep === "MENU_UPDATE_SELECT") {
      const menuName = normalizedMsg;
      const menuList: any = await executeTool("GET_MENU_ITEMS", {}, token);
      if (menuList.error) {
        resetMenuConversation(session);
        return "Unable to load menu items.";
      }
      const menuItem = (menuList.data || []).find((m: any) => normalizeOrderValue(m.name) === normalizeOrderValue(menuName));
      if (!menuItem) {
        return `I couldn't find the menu item '${menuName}'. Which menu item would you like to update?`;
      }
      session.collectedFields.id = menuItem.id || menuItem._id;
      session.collectedFields.name = menuItem.name;
      session.currentStep = "MENU_UPDATE_FIELD";
      return "What would you like to update? (Name, Price, Cost Price, Category, Veg Type)";
    }
    if (session.currentStep === "MENU_UPDATE_FIELD") {
      const field = normalizedMsg.toLowerCase();
      if (field.includes("name")) {
        session.currentStep = "MENU_UPDATE_NAME_VALUE";
        return "What is the new name?";
      } else if (field.includes("cost") || field.includes("cost price")) {
        session.currentStep = "MENU_UPDATE_COST_VALUE";
        return "What is the new cost price?";
      } else if (field.includes("price") || field.includes("selling price")) {
        session.currentStep = "MENU_UPDATE_PRICE_VALUE";
        return "What is the new selling price?";
      } else if (field.includes("category")) {
        session.currentStep = "MENU_UPDATE_CATEGORY_VALUE";
        return "Which category?";
      } else if (field.includes("veg") || field.includes("type")) {
        session.currentStep = "MENU_UPDATE_VEG_VALUE";
        return "Is it VEG, NON_VEG or EGG?";
      } else {
        return "What would you like to update? (Name, Price, Cost Price, Category, Veg Type)";
      }
    }
    if (session.currentStep === "MENU_UPDATE_NAME_VALUE") {
      const newName = normalizedMsg;
      if (!newName) return "What is the new name?";
      const result = await executeTool("UPDATE_MENU_ITEM", { id: session.collectedFields.id, name: newName }, token);
      resetMenuConversation(session);
      if (result.error) return formatFriendlyError(result);
      await executeTool("GET_MENU_ITEMS", {}, token);
      return "✅ Menu item updated successfully.";
    }
    if (session.currentStep === "MENU_UPDATE_COST_VALUE") {
      const costPrice = Number(normalizedMsg);
      if (isNaN(costPrice) || costPrice < 0) return "What is the new cost price?";
      const result = await executeTool("UPDATE_MENU_ITEM", { id: session.collectedFields.id, costPrice }, token);
      resetMenuConversation(session);
      if (result.error) return formatFriendlyError(result);
      await executeTool("GET_MENU_ITEMS", {}, token);
      return "✅ Menu item updated successfully.";
    }
    if (session.currentStep === "MENU_UPDATE_PRICE_VALUE") {
      const price = Number(normalizedMsg);
      if (isNaN(price) || price <= 0) return "What is the new selling price?";
      const result = await executeTool("UPDATE_MENU_ITEM", { id: session.collectedFields.id, price }, token);
      resetMenuConversation(session);
      if (result.error) return formatFriendlyError(result);
      await executeTool("GET_MENU_ITEMS", {}, token);
      return "✅ Menu item updated successfully.";
    }
    if (session.currentStep === "MENU_UPDATE_CATEGORY_VALUE") {
      const catName = normalizedMsg;
      const catList: any = await executeTool("GET_CATEGORIES", {}, token);
      if (catList.error) return "Unable to load categories.";
      const category = (catList.data || []).find((c: any) => normalizeOrderValue(c.name) === normalizeOrderValue(catName));
      if (!category) {
        return `I couldn't find the category '${catName}'. Please choose an existing category.`;
      }
      const result = await executeTool("UPDATE_MENU_ITEM", { id: session.collectedFields.id, categoryId: category.id || category._id }, token);
      resetMenuConversation(session);
      if (result.error) return formatFriendlyError(result);
      await executeTool("GET_MENU_ITEMS", {}, token);
      return "✅ Menu item updated successfully.";
    }
    if (session.currentStep === "MENU_UPDATE_VEG_VALUE") {
      const vegType = normalizedMsg.toUpperCase();
      if (!["VEG", "NON_VEG", "EGG"].includes(vegType)) return "Is it VEG, NON_VEG or EGG?";
      const result = await executeTool("UPDATE_MENU_ITEM", { id: session.collectedFields.id, vegType }, token);
      resetMenuConversation(session);
      if (result.error) return formatFriendlyError(result);
      await executeTool("GET_MENU_ITEMS", {}, token);
      return "✅ Menu item updated successfully.";
    }
  }

  if (session.pendingTool === "DELETE_MENU_ITEM") {
    if (session.currentStep === "MENU_DELETE_SELECT") {
      const menuName = normalizedMsg;
      const menuList: any = await executeTool("GET_MENU_ITEMS", {}, token);
      if (menuList.error) {
        resetMenuConversation(session);
        return "Unable to load menu items.";
      }
      const menuItem = (menuList.data || []).find((m: any) => normalizeOrderValue(m.name) === normalizeOrderValue(menuName));
      if (!menuItem) {
        return `I couldn't find the menu item '${menuName}'. Which menu item would you like to delete?`;
      }
      session.collectedFields.id = menuItem.id || menuItem._id;
      session.collectedFields.name = menuItem.name;
      session.currentStep = "MENU_DELETE_CONFIRM";
      return `Are you sure you want to delete the menu item '${menuItem.name}'? (Yes/No)`;
    }
    if (session.currentStep === "MENU_DELETE_CONFIRM") {
      const answer = normalizedMsg.toLowerCase();
      if (answer === "yes" || answer === "y") {
        const result = await executeTool("DELETE_MENU_ITEM", { id: session.collectedFields.id }, token);
        resetMenuConversation(session);
        if (result.error) return formatFriendlyError(result);
        await executeTool("GET_MENU_ITEMS", {}, token);
        return "✅ Menu item deleted successfully.";
      } else if (answer === "no" || answer === "n") {
        resetMenuConversation(session);
        return "Operation cancelled.";
      } else {
        return `Are you sure you want to delete the menu item '${session.collectedFields.name}'? (Yes/No)`;
      }
    }
  }

  resetMenuConversation(session);
  return null;
}

function resetTableConversation(session: any) {
  session.pendingTool = undefined;
  session.currentStep = "IDLE";
  session.collectedFields = {};
}

async function handleTableConversation(message: string, session: any, token: string): Promise<string | null> {
  const normalizedMsg = String(message ?? "").trim();
  const startsCreate = /\b(create|add|new)\b.*\btable\b/i.test(normalizedMsg);
  const startsUpdate = /\b(update|edit|modify)\b.*\btable\b/i.test(normalizedMsg);
  const startsDelete = /\b(delete|remove)\b.*\btable\b/i.test(normalizedMsg);

  if (normalizedMsg.toLowerCase() === "cancel") {
    resetTableConversation(session);
    return "Operation cancelled.";
  }

  // Init flow
  if (!session.pendingTool) {
    if (startsCreate) {
      session.pendingTool = "CREATE_TABLE";
      session.currentStep = "TABLE_CREATE_NAME";
      session.collectedFields = {};
      return "What is the table name?";
    } else if (startsUpdate) {
      session.pendingTool = "UPDATE_TABLE";
      session.currentStep = "TABLE_UPDATE_SELECT";
      session.collectedFields = {};
      return "Which table would you like to update?";
    } else if (startsDelete) {
      session.pendingTool = "DELETE_TABLE";
      session.currentStep = "TABLE_DELETE_SELECT";
      session.collectedFields = {};
      return "Which table would you like to delete?";
    }
    return null;
  }

  // Flow execution
  if (session.pendingTool === "CREATE_TABLE") {
    if (session.currentStep === "TABLE_CREATE_NAME") {
      const name = normalizedMsg;
      if (!name) return "What is the table name?";
      session.collectedFields.name = name;
      session.currentStep = "TABLE_CREATE_CAPACITY";
      return "What is the seating capacity?";
    }
    if (session.currentStep === "TABLE_CREATE_CAPACITY") {
      const capacity = Number(normalizedMsg);
      if (isNaN(capacity) || capacity <= 0) return "What is the seating capacity?";
      session.collectedFields.capacity = capacity;
      session.currentStep = "TABLE_CREATE_STATUS";
      return "What is the status? (AVAILABLE, OCCUPIED, RESERVED, CLEANING)";
    }
    if (session.currentStep === "TABLE_CREATE_STATUS") {
      let status = normalizedMsg.toUpperCase();
      if (status === "MAINTENANCE") status = "CLEANING";
      if (!["AVAILABLE", "OCCUPIED", "RESERVED", "CLEANING"].includes(status)) {
        return "What is the status? (AVAILABLE, OCCUPIED, RESERVED, CLEANING)";
      }
      session.collectedFields.status = status;

      const result = await executeTool("CREATE_TABLE", session.collectedFields, token);
      if (result.error) {
        resetTableConversation(session);
        return formatFriendlyError(result);
      }
      const createdName = session.collectedFields.name;
      const createdCapacity = session.collectedFields.capacity;
      resetTableConversation(session);
      await executeTool("LIST_TABLES", {}, token);
      return `✅ Table "${createdName}" created successfully.\n\nCapacity: ${createdCapacity}\nStatus: ${status}`;
    }
  }

  if (session.pendingTool === "UPDATE_TABLE") {
    if (session.currentStep === "TABLE_UPDATE_SELECT") {
      const tableName = normalizedMsg;
      const tableList: any = await executeTool("LIST_TABLES", {}, token);
      if (tableList.error) {
        resetTableConversation(session);
        return "Unable to load tables.";
      }
      const table = (tableList.data || []).find((t: any) => normalizeOrderValue(t.name) === normalizeOrderValue(tableName));
      if (!table) {
        return `Table "${tableName}" was not found. Which table would you like to update?`;
      }
      session.collectedFields.id = table.id || table._id;
      session.collectedFields.name = table.name;
      session.currentStep = "TABLE_UPDATE_FIELD";
      return "What would you like to update? (Name, Capacity, Status)";
    }
    if (session.currentStep === "TABLE_UPDATE_FIELD") {
      const field = normalizedMsg.toLowerCase();
      if (field.includes("name")) {
        session.currentStep = "TABLE_UPDATE_NAME_VALUE";
        return "What is the new name?";
      } else if (field.includes("capacity")) {
        session.currentStep = "TABLE_UPDATE_CAPACITY_VALUE";
        return "What should the seating capacity be?";
      } else if (field.includes("status")) {
        session.currentStep = "TABLE_UPDATE_STATUS_VALUE";
        return "What status should be set? (AVAILABLE, OCCUPIED, RESERVED, CLEANING)";
      } else {
        return "What would you like to update? (Name, Capacity, Status)";
      }
    }
    if (session.currentStep === "TABLE_UPDATE_NAME_VALUE") {
      const newName = normalizedMsg;
      if (!newName) return "What is the new name?";
      const result = await executeTool("UPDATE_TABLE", { id: session.collectedFields.id, name: newName }, token);
      resetTableConversation(session);
      if (result.error) return formatFriendlyError(result);
      await executeTool("LIST_TABLES", {}, token);
      return "✅ Table updated successfully.";
    }
    if (session.currentStep === "TABLE_UPDATE_CAPACITY_VALUE") {
      const capacity = Number(normalizedMsg);
      if (isNaN(capacity) || capacity <= 0) return "What should the seating capacity be?";
      const result = await executeTool("UPDATE_TABLE", { id: session.collectedFields.id, capacity }, token);
      resetTableConversation(session);
      if (result.error) return formatFriendlyError(result);
      await executeTool("LIST_TABLES", {}, token);
      return "✅ Table updated successfully.";
    }
    if (session.currentStep === "TABLE_UPDATE_STATUS_VALUE") {
      let status = normalizedMsg.toUpperCase();
      if (status === "MAINTENANCE") status = "CLEANING";
      if (!["AVAILABLE", "OCCUPIED", "RESERVED", "CLEANING"].includes(status)) {
        return "What status should be set? (AVAILABLE, OCCUPIED, RESERVED, CLEANING)";
      }
      const result = await executeTool("UPDATE_TABLE", { id: session.collectedFields.id, status }, token);
      resetTableConversation(session);
      if (result.error) return formatFriendlyError(result);
      await executeTool("LIST_TABLES", {}, token);
      return "✅ Table updated successfully.";
    }
  }

  if (session.pendingTool === "DELETE_TABLE") {
    if (session.currentStep === "TABLE_DELETE_SELECT") {
      const tableName = normalizedMsg;
      const tableList: any = await executeTool("LIST_TABLES", {}, token);
      if (tableList.error) {
        resetTableConversation(session);
        return "Unable to load tables.";
      }
      const table = (tableList.data || []).find((t: any) => normalizeOrderValue(t.name) === normalizeOrderValue(tableName));
      if (!table) {
        return `Table "${tableName}" was not found. Which table would you like to delete?`;
      }
      session.collectedFields.id = table.id || table._id;
      session.collectedFields.name = table.name;
      session.currentStep = "TABLE_DELETE_CONFIRM";
      return `Are you sure you want to delete the table '${table.name}'? (Yes/No)`;
    }
    if (session.currentStep === "TABLE_DELETE_CONFIRM") {
      const answer = normalizedMsg.toLowerCase();
      if (answer === "yes" || answer === "y") {
        const result = await executeTool("DELETE_TABLE", { id: session.collectedFields.id }, token);
        resetTableConversation(session);
        if (result.error) return formatFriendlyError(result);
        await executeTool("LIST_TABLES", {}, token);
        return "✅ Table deleted successfully.";
      } else if (answer === "no" || answer === "n") {
        resetTableConversation(session);
        return "Operation cancelled.";
      } else {
        return `Are you sure you want to delete the table '${session.collectedFields.name}'? (Yes/No)`;
      }
    }
  }

  resetTableConversation(session);
  return null;
}

function resetRoleConversation(session: any) {
  session.pendingTool = undefined;
  session.currentStep = "IDLE";
  session.collectedFields = {};
}

async function handleRoleConversation(message: string, session: any, token: string): Promise<string | null> {
  const normalizedMsg = String(message ?? "").trim();
  const startsCreate = /\b(create|add|new)\b.*\brole\b/i.test(normalizedMsg);
  const startsUpdate = /\b(update|edit|modify)\b.*\brole\b/i.test(normalizedMsg);
  const startsDelete = /\b(delete|remove)\b.*\brole\b/i.test(normalizedMsg);

  if (normalizedMsg.toLowerCase() === "cancel") {
    resetRoleConversation(session);
    return "Operation cancelled.";
  }

  // Init flow
  if (!session.pendingTool) {
    if (startsCreate) {
      session.pendingTool = "CREATE_ROLE";
      session.currentStep = "ROLE_CREATE_NAME";
      session.collectedFields = {};
      return "What is the role name?";
    } else if (startsUpdate) {
      session.pendingTool = "UPDATE_ROLE";
      session.currentStep = "ROLE_UPDATE_SELECT";
      session.collectedFields = {};
      return "Which role would you like to update?";
    } else if (startsDelete) {
      session.pendingTool = "DELETE_ROLE";
      session.currentStep = "ROLE_DELETE_SELECT";
      session.collectedFields = {};
      return "Which role would you like to delete?";
    }
    return null;
  }

  // Flow execution
  if (session.pendingTool === "CREATE_ROLE") {
    if (session.currentStep === "ROLE_CREATE_NAME") {
      const name = normalizedMsg;
      if (!name) return "What is the role name?";
      session.collectedFields.name = name;
      session.currentStep = "ROLE_CREATE_DESC";
      return "What is the description?";
    }
    if (session.currentStep === "ROLE_CREATE_DESC") {
      session.collectedFields.description = normalizedMsg;
      session.currentStep = "ROLE_CREATE_PERMS";
      return "What permissions should be assigned? (Provide comma-separated list, e.g. dashboard.view, pos.view)";
    }
    if (session.currentStep === "ROLE_CREATE_PERMS") {
      const perms = normalizedMsg ? normalizedMsg.split(",").map(p => p.trim()).filter(Boolean) : [];
      session.collectedFields.permissions = perms;

      const result = await executeTool("CREATE_ROLE", session.collectedFields, token);
      resetRoleConversation(session);
      if (result.error) return formatFriendlyError(result);
      await executeTool("GET_ROLES", {}, token);
      return "✅ Role created successfully.";
    }
  }

  if (session.pendingTool === "UPDATE_ROLE") {
    if (session.currentStep === "ROLE_UPDATE_SELECT") {
      const roleName = normalizedMsg;
      const roleList: any = await executeTool("GET_ROLES", {}, token);
      if (roleList.error) {
        resetRoleConversation(session);
        return "Unable to load roles.";
      }
      const role = (roleList.data || []).find((r: any) => normalizeOrderValue(r.name) === normalizeOrderValue(roleName));
      if (!role) {
        return `I couldn't find the role '${roleName}'. Which role would you like to update?`;
      }
      session.collectedFields.id = role.id || role._id;
      session.collectedFields.name = role.name;
      session.currentStep = "ROLE_UPDATE_FIELD";
      return "What would you like to update? (Name, Description, Permissions)";
    }
    if (session.currentStep === "ROLE_UPDATE_FIELD") {
      const field = normalizedMsg.toLowerCase();
      if (field.includes("name")) {
        session.currentStep = "ROLE_UPDATE_NAME_VALUE";
        return "What is the new name?";
      } else if (field.includes("description") || field.includes("desc")) {
        session.currentStep = "ROLE_UPDATE_DESC_VALUE";
        return "What is the new description?";
      } else if (field.includes("permission") || field.includes("perms")) {
        session.currentStep = "ROLE_UPDATE_PERMS_VALUE";
        return "What are the new permissions? (Provide comma-separated list)";
      } else {
        return "What would you like to update? (Name, Description, Permissions)";
      }
    }
    if (session.currentStep === "ROLE_UPDATE_NAME_VALUE") {
      const newName = normalizedMsg;
      if (!newName) return "What is the new name?";
      const result = await executeTool("UPDATE_ROLE", { id: session.collectedFields.id, name: newName }, token);
      resetRoleConversation(session);
      if (result.error) return formatFriendlyError(result);
      await executeTool("GET_ROLES", {}, token);
      return "✅ Role updated successfully.";
    }
    if (session.currentStep === "ROLE_UPDATE_DESC_VALUE") {
      const result = await executeTool("UPDATE_ROLE", { id: session.collectedFields.id, description: normalizedMsg }, token);
      resetRoleConversation(session);
      if (result.error) return formatFriendlyError(result);
      await executeTool("GET_ROLES", {}, token);
      return "✅ Role updated successfully.";
    }
    if (session.currentStep === "ROLE_UPDATE_PERMS_VALUE") {
      const perms = normalizedMsg ? normalizedMsg.split(",").map(p => p.trim()).filter(Boolean) : [];
      const result = await executeTool("UPDATE_ROLE", { id: session.collectedFields.id, permissions: perms }, token);
      resetRoleConversation(session);
      if (result.error) return formatFriendlyError(result);
      await executeTool("GET_ROLES", {}, token);
      return "✅ Role updated successfully.";
    }
  }

  if (session.pendingTool === "DELETE_ROLE") {
    if (session.currentStep === "ROLE_DELETE_SELECT") {
      const roleName = normalizedMsg;
      const roleList: any = await executeTool("GET_ROLES", {}, token);
      if (roleList.error) {
        resetRoleConversation(session);
        return "Unable to load roles.";
      }
      const role = (roleList.data || []).find((r: any) => normalizeOrderValue(r.name) === normalizeOrderValue(roleName));
      if (!role) {
        return `I couldn't find the role '${roleName}'. Which role would you like to delete?`;
      }
      session.collectedFields.roleId = role.id || role._id;
      session.collectedFields.roleName = role.name;
      session.currentStep = "ROLE_DELETE_CONFIRM";
      return `Are you sure you want to delete '${role.name}'? (Yes/No)`;
    }
    if (session.currentStep === "ROLE_DELETE_CONFIRM") {
      const answer = normalizedMsg.toLowerCase();
      if (answer === "yes" || answer === "y") {
        const result = await executeTool("DELETE_ROLE", { roleId: session.collectedFields.roleId }, token);
        resetRoleConversation(session);
        if (result.error) return formatFriendlyError(result);
        await executeTool("GET_ROLES", {}, token);
        return "✅ Role deleted successfully.";
      } else if (answer === "no" || answer === "n") {
        resetRoleConversation(session);
        return "Operation cancelled.";
      } else {
        return `Are you sure you want to delete '${session.collectedFields.roleName}'? (Yes/No)`;
      }
    }
  }

  resetRoleConversation(session);
  return null;
}

function resetInventoryConversation(session: any) {
  session.pendingTool = undefined;
  session.currentStep = "IDLE";
  session.collectedFields = {};
}

async function handleInventoryConversation(message: string, session: any, token: string): Promise<string | null> {
  const normalizedMsg = String(message ?? "").trim();
  const startsCreate = /\b(create|add|new)\b.*\binventory\b/i.test(normalizedMsg);
  const startsUpdate = /\b(update|edit|modify)\b.*\binventory\b/i.test(normalizedMsg);
  const startsDelete = /\b(delete|remove)\b.*\binventory\b/i.test(normalizedMsg);

  if (normalizedMsg.toLowerCase() === "cancel") {
    resetInventoryConversation(session);
    return "Operation cancelled.";
  }

  // Init flow
  if (!session.pendingTool) {
    if (startsCreate) {
      session.pendingTool = "CREATE_INVENTORY";
      session.currentStep = "INV_CREATE_NAME";
      session.collectedFields = {};
      return "What is the inventory item name?";
    } else if (startsUpdate) {
      session.pendingTool = "UPDATE_INVENTORY";
      session.currentStep = "INV_UPDATE_SELECT";
      session.collectedFields = {};
      return "Which inventory item would you like to update?";
    } else if (startsDelete) {
      session.pendingTool = "DELETE_INVENTORY";
      session.currentStep = "INV_DELETE_SELECT";
      session.collectedFields = {};
      return "Which inventory item would you like to delete?";
    }
    return null;
  }

  // Flow execution
  if (session.pendingTool === "CREATE_INVENTORY") {
    if (session.currentStep === "INV_CREATE_NAME") {
      const name = normalizedMsg;
      if (!name) return "What is the inventory item name?";
      session.collectedFields.name = name;
      session.currentStep = "INV_CREATE_UNIT";
      return "What is the unit of measurement? (e.g., kg, liters, units)";
    }
    if (session.currentStep === "INV_CREATE_UNIT") {
      const unit = normalizedMsg;
      if (!unit) return "What is the unit of measurement? (e.g., kg, liters, units)";
      session.collectedFields.unit = unit;
      session.currentStep = "INV_CREATE_QTY";
      return "What is the starting quantity?";
    }
    if (session.currentStep === "INV_CREATE_QTY") {
      const quantity = Number(normalizedMsg);
      if (isNaN(quantity) || quantity < 0) return "What is the starting quantity?";
      session.collectedFields.quantity = quantity;
      session.currentStep = "INV_CREATE_REORDER";
      return "What is the reorder level?";
    }
    if (session.currentStep === "INV_CREATE_REORDER") {
      const reorderLevel = Number(normalizedMsg);
      if (isNaN(reorderLevel) || reorderLevel < 0) return "What is the reorder level?";
      session.collectedFields.reorderLevel = reorderLevel;

      const result = await executeTool("CREATE_INVENTORY", session.collectedFields, token);
      resetInventoryConversation(session);
      if (result.error) return formatFriendlyError(result);
      await executeTool("GET_INVENTORY", {}, token);
      return "✅ Inventory item created successfully.";
    }
  }

  if (session.pendingTool === "UPDATE_INVENTORY") {
    if (session.currentStep === "INV_UPDATE_SELECT") {
      const itemName = normalizedMsg;
      const invList: any = await executeTool("GET_INVENTORY", {}, token);
      if (invList.error) {
        resetInventoryConversation(session);
        return "Unable to load inventory.";
      }
      const item = (invList.data || []).find((i: any) => normalizeOrderValue(i.name) === normalizeOrderValue(itemName));
      if (!item) {
        return `I couldn't find the inventory item '${itemName}'. Which inventory item would you like to update?`;
      }
      session.collectedFields.id = item.id || item._id;
      session.collectedFields.name = item.name;
      session.currentStep = "INV_UPDATE_QTY";
      return "What is the new quantity?";
    }
    if (session.currentStep === "INV_UPDATE_QTY") {
      const quantity = Number(normalizedMsg);
      if (isNaN(quantity) || quantity < 0) return "What is the new quantity?";
      const result = await executeTool("UPDATE_INVENTORY", { id: session.collectedFields.id, quantity }, token);
      resetInventoryConversation(session);
      if (result.error) return formatFriendlyError(result);
      await executeTool("GET_INVENTORY", {}, token);
      return "✅ Inventory updated successfully.";
    }
  }

  if (session.pendingTool === "DELETE_INVENTORY") {
    if (session.currentStep === "INV_DELETE_SELECT") {
      const itemName = normalizedMsg;
      const invList: any = await executeTool("GET_INVENTORY", {}, token);
      if (invList.error) {
        resetInventoryConversation(session);
        return "Unable to load inventory.";
      }
      const item = (invList.data || []).find((i: any) => normalizeOrderValue(i.name) === normalizeOrderValue(itemName));
      if (!item) {
        return `I couldn't find the inventory item '${itemName}'. Which inventory item would you like to delete?`;
      }
      session.collectedFields.id = item.id || item._id;
      session.collectedFields.name = item.name;
      session.currentStep = "INV_DELETE_CONFIRM";
      return `Are you sure you want to delete the inventory item '${item.name}'? (Yes/No)`;
    }
    if (session.currentStep === "INV_DELETE_CONFIRM") {
      const answer = normalizedMsg.toLowerCase();
      if (answer === "yes" || answer === "y") {
        const result = await executeTool("DELETE_INVENTORY", { id: session.collectedFields.id }, token);
        resetInventoryConversation(session);
        if (result.error) return formatFriendlyError(result);
        await executeTool("GET_INVENTORY", {}, token);
        return "✅ Inventory deleted successfully.";
      } else if (answer === "no" || answer === "n") {
        resetInventoryConversation(session);
        return "Operation cancelled.";
      } else {
        return `Are you sure you want to delete the inventory item '${session.collectedFields.name}'? (Yes/No)`;
      }
    }
  }

  resetInventoryConversation(session);
  return null;
}

async function handleUserConversation(message: string, session: any, token: string): Promise<string | null> {
  const normalizedMsg = String(message ?? "").trim();
  
  const startsUserCreate = /\b(create|add|new)\b.*\buser\b/i.test(normalizedMsg);
  const startsUserUpdate = /\b(update|edit|modify)\b.*\buser\b/i.test(normalizedMsg);
  const startsUserDelete = /\b(delete|remove)\b.*\buser\b/i.test(normalizedMsg);

  const activeUserTool = ["CREATE_USER", "UPDATE_USER", "DELETE_USER"].includes(session.pendingTool || "");
  if (!activeUserTool && !startsUserCreate && !startsUserUpdate && !startsUserDelete) {
    return null;
  }

  if (normalizedMsg.toLowerCase() === "cancel") {
    resetUserConversation(session);
    return "Operation cancelled.";
  }

  // 1. Detect start of flows
  if (!activeUserTool) {
    if (startsUserCreate) {
      session.pendingTool = "CREATE_USER";
      session.currentStep = "USER_CREATE_NAME";
      session.collectedFields = {};
      return "What is the user's full name?";
    } else if (startsUserUpdate) {
      session.pendingTool = "UPDATE_USER";
      session.currentStep = "USER_UPDATE_EMAIL";
      session.collectedFields = {};
      return "What is the email address of the user you want to update?";
    } else if (startsUserDelete) {
      session.pendingTool = "DELETE_USER";
      session.currentStep = "USER_DELETE_EMAIL";
      session.collectedFields = {};
      return "What is the email address of the user you want to delete?";
    }
  }

  // 2. CREATE_USER Flow
  if (session.pendingTool === "CREATE_USER") {
    if (session.currentStep === "USER_CREATE_NAME") {
      const name = normalizedMsg;
      if (!name) return "What is the user's full name?";
      session.collectedFields.name = name;
      session.currentStep = "USER_CREATE_EMAIL";
      return "What is the email address?";
    }

    if (session.currentStep === "USER_CREATE_EMAIL") {
      const email = normalizedMsg;
      if (!email) return "What is the email address?";
      session.collectedFields.email = email;
      session.currentStep = "USER_CREATE_PASSWORD";
      return "What password should be assigned?";
    }

    if (session.currentStep === "USER_CREATE_PASSWORD") {
      const password = normalizedMsg;
      if (!password) return "What password should be assigned?";
      session.collectedFields.password = password;
      session.currentStep = "USER_CREATE_ROLE";
      return "Which role should be assigned?";
    }

    if (session.currentStep === "USER_CREATE_ROLE") {
      const roleName = normalizedMsg;
      if (!roleName) return "Which role should be assigned?";
      session.collectedFields.role = roleName;

      // Check GET_ROLES API
      const rolesResult: any = await executeTool("GET_ROLES", {}, token);
      if (rolesResult.error) {
        resetUserConversation(session);
        return rolesResult.message || "Unable to load roles.";
      }

      const roleList = Array.isArray(rolesResult.data) ? rolesResult.data : [];
      const matchedRole = roleList.find((r: any) => 
        (r.name && r.name.toLowerCase() === roleName.toLowerCase()) ||
        (r.displayName && r.displayName.toLowerCase() === roleName.toLowerCase())
      );

      if (matchedRole) {
        // Execute CREATE_USER immediately
        const payload = {
          name: session.collectedFields.name,
          email: session.collectedFields.email,
          password: session.collectedFields.password,
          roleId: matchedRole.id || matchedRole._id
        };
        const result: any = await executeTool("CREATE_USER", payload, token);
        resetUserConversation(session);
        if (result.error) return formatFriendlyError(result);
        await executeTool("GET_USERS", {}, token);
        return "✅ User created successfully.";
      } else {
        // Role does not exist
        session.currentStep = "USER_CREATE_ROLE_FALLBACK";
        return `The role "${roleName}" doesn't exist. Would you like to create it? (Yes/No)`;
      }
    }

    if (session.currentStep === "USER_CREATE_ROLE_FALLBACK") {
      const answer = normalizedMsg.toLowerCase();
      if (answer === "yes" || answer === "y") {
        const roleName = session.collectedFields.role;
        // Create role internally
        const createRoleResult = await executeTool("CREATE_ROLE", { name: roleName, permissions: [] }, token);
        if (createRoleResult.error) {
          resetUserConversation(session);
          return createRoleResult.message || "Failed to create role.";
        }

        // Refresh roles
        const rolesResult: any = await executeTool("GET_ROLES", {}, token);
        if (rolesResult.error) {
          resetUserConversation(session);
          return rolesResult.message || "Unable to load roles.";
        }
        const roleList = Array.isArray(rolesResult.data) ? rolesResult.data : [];
        const matchedRole = roleList.find((r: any) => 
          (r.name && r.name.toLowerCase() === roleName.toLowerCase()) ||
          (r.displayName && r.displayName.toLowerCase() === roleName.toLowerCase())
        );

        if (!matchedRole) {
          resetUserConversation(session);
          return "Failed to resolve role ID for newly created role.";
        }

        // Execute CREATE_USER
        const payload = {
          name: session.collectedFields.name,
          email: session.collectedFields.email,
          password: session.collectedFields.password,
          roleId: matchedRole.id || matchedRole._id
        };

        const result: any = await executeTool("CREATE_USER", payload, token);
        resetUserConversation(session);
        if (result.error) return formatFriendlyError(result);
        await executeTool("GET_USERS", {}, token);
        return "✅ Role created successfully.\n✅ User created successfully.";
      } else if (answer === "no" || answer === "n") {
        resetUserConversation(session);
        return "Operation cancelled.";
      } else {
        return `The role "${session.collectedFields.role}" doesn't exist. Would you like to create it? (Yes/No)`;
      }
    }
  }

  // 3. UPDATE_USER Flow
  if (session.pendingTool === "UPDATE_USER") {
    if (session.currentStep === "USER_UPDATE_EMAIL") {
      const email = normalizedMsg;
      const userList: any = await executeTool("GET_USERS", {}, token);
      if (userList.error) {
        resetUserConversation(session);
        return "Unable to load users.";
      }
      const user = (userList.data || []).find((u: any) => normalizeOrderValue(u.email) === normalizeOrderValue(email));
      if (!user) {
        return `User "${email}" was not found. What is the email address of the user you want to update?`;
      }
      session.collectedFields.id = user.id || user._id;
      session.collectedFields.email = user.email;
      session.currentStep = "USER_UPDATE_SELECT_FIELD";
      return "What would you like to update? (Name, Role, Active Status)";
    }

    if (session.currentStep === "USER_UPDATE_SELECT_FIELD") {
      const option = normalizedMsg.toLowerCase();
      if (option.includes("name")) {
        session.currentStep = "USER_UPDATE_NAME_VALUE";
        return "What is the new name?";
      } else if (option.includes("role")) {
        session.currentStep = "USER_UPDATE_ROLE_VALUE";
        return "Which role should be assigned?";
      } else if (option.includes("active") || option.includes("status")) {
        session.currentStep = "USER_UPDATE_ACTIVE_VALUE";
        return "Should the user be active? (Yes/No)";
      } else {
        return "What would you like to update? (Name, Role, Active Status)";
      }
    }

    if (session.currentStep === "USER_UPDATE_NAME_VALUE") {
      const newName = normalizedMsg;
      if (!newName) return "What is the new name?";
      const result: any = await executeTool("UPDATE_USER", { id: session.collectedFields.id, newName }, token);
      resetUserConversation(session);
      if (result.error) return formatFriendlyError(result);
      await executeTool("GET_USERS", {}, token);
      return "✅ User updated successfully.";
    }

    if (session.currentStep === "USER_UPDATE_ROLE_VALUE") {
      const roleName = normalizedMsg;
      if (!roleName) return "Which role should be assigned?";

      const rolesResult: any = await executeTool("GET_ROLES", {}, token);
      if (rolesResult.error) {
        resetUserConversation(session);
        return rolesResult.message || "Unable to load roles.";
      }

      const roleList = Array.isArray(rolesResult.data) ? rolesResult.data : [];
      const matchedRole = roleList.find((r: any) => 
        (r.name && r.name.toLowerCase() === roleName.toLowerCase()) ||
        (r.displayName && r.displayName.toLowerCase() === roleName.toLowerCase())
      );

      if (!matchedRole) {
        resetUserConversation(session);
        return `The role '${roleName}' doesn't exist. Would you like me to create it first?`;
      }

      const result: any = await executeTool("UPDATE_USER", { id: session.collectedFields.id, roleId: matchedRole.id || matchedRole._id }, token);
      resetUserConversation(session);
      if (result.error) return formatFriendlyError(result);
      await executeTool("GET_USERS", {}, token);
      return "✅ User updated successfully.";
    }

    if (session.currentStep === "USER_UPDATE_ACTIVE_VALUE") {
      const activeStr = normalizedMsg.toLowerCase();
      let active: boolean;
      if (activeStr === "yes" || activeStr === "y" || activeStr === "true") {
        active = true;
      } else if (activeStr === "no" || activeStr === "n" || activeStr === "false") {
        active = false;
      } else {
        return "Should the user be active? (Yes/No)";
      }

      const result: any = await executeTool("UPDATE_USER", { id: session.collectedFields.id, active }, token);
      resetUserConversation(session);
      if (result.error) return formatFriendlyError(result);
      await executeTool("GET_USERS", {}, token);
      return "✅ User updated successfully.";
    }
  }

  // 4. DELETE_USER Flow
  if (session.pendingTool === "DELETE_USER") {
    if (session.currentStep === "USER_DELETE_EMAIL") {
      const email = normalizedMsg;
      const userList: any = await executeTool("GET_USERS", {}, token);
      if (userList.error) {
        resetUserConversation(session);
        return "Unable to load users.";
      }
      const user = (userList.data || []).find((u: any) => normalizeOrderValue(u.email) === normalizeOrderValue(email));
      if (!user) {
        return `User "${email}" was not found. What is the email address of the user you want to delete?`;
      }
      session.collectedFields.id = user.id || user._id;
      session.collectedFields.email = user.email;
      session.currentStep = "USER_DELETE_CONFIRM";
      return `Are you sure you want to delete the user with email '${user.email}'? (Yes/No)`;
    }

    if (session.currentStep === "USER_DELETE_CONFIRM") {
      const confirmStr = normalizedMsg.toLowerCase();
      if (confirmStr === "yes" || confirmStr === "y") {
        const result: any = await executeTool("DELETE_USER", { id: session.collectedFields.id }, token);
        resetUserConversation(session);
        if (result.error) return formatFriendlyError(result);
        await executeTool("GET_USERS", {}, token);
        return "✅ User deleted successfully.";
      } else if (confirmStr === "no" || confirmStr === "n") {
        resetUserConversation(session);
        return "Operation cancelled.";
      } else {
        return `Are you sure you want to delete the user with email '${session.collectedFields.email}'? (Yes/No)`;
      }
    }
  }

  resetUserConversation(session);
  return null;
}

/** Keeps CREATE_ORDER independent from model memory and unregistered tool names. */
async function handleOrderConversation(message: string, session: any, token: string): Promise<string | null> {
  const startsOrder = /\b(create|start|new|place)\b.*\border\b|\border\b.*\b(create|start|new|place)\b/i.test(message);
  const normalizedMsg = String(message ?? "").trim();
  const startsCreate = /\b(create|start|new|place)\b.*\border\b/i.test(normalizedMsg) || /\border\b.*\b(create|start|new|place)\b/i.test(normalizedMsg);
  const startsUpdate = /\b(update|edit|modify)\b.*\border\b/i.test(normalizedMsg);
  const startsDelete = /\b(delete|remove)\b.*\border\b/i.test(normalizedMsg);

  if (normalizedMsg.toLowerCase() === "cancel") {
    resetOrderConversation(session);
    return "Operation cancelled.";
  }

  // Init flow
  if (!session.pendingTool) {
    if (startsCreate) {
      session.pendingTool = "CREATE_ORDER";
      session.currentStep = "ORDER_TABLE";
      session.collectedFields = { items: [] };
      return "Which table would you like to create the order for?";
    } else if (startsUpdate) {
      session.pendingTool = "UPDATE_ORDER";
      session.currentStep = "ORDER_UPDATE_SELECT";
      session.collectedFields = {};
      return "Which order number would you like to update?";
    } else if (startsDelete) {
      session.pendingTool = "DELETE_ORDER";
      session.currentStep = "ORDER_DELETE_SELECT";
      session.collectedFields = {};
      return "Which order number would you like to delete?";
    }
    return null;
  }

  // Flow execution
  if (session.pendingTool === "CREATE_ORDER") {
    if (session.currentStep === "ORDER_TABLE") {
      const tableName = normalizedMsg;
      if (!tableName) return "Which table would you like to create the order for?";
      
      const tableLookup = ["GET_TABLE", "GET_TABLES", "LIST_TABLES"].find(name => registeredToolNames.has(name)) || "LIST_TABLES";
      const tableResult: any = await executeTool(tableLookup, {}, token);
      if (tableResult.error) return tableResult.message || "Unable to look up tables.";
      
      const tables = Array.isArray(tableResult.data) ? tableResult.data : [];
      const table = tables.find((t: any) => t.name && t.name.trim().toLowerCase() === tableName.toLowerCase());
      if (!table) {
        return `Table "${tableName}" was not found.`;
      }
      
      session.collectedFields.tableId = table.id || table._id;
      session.currentStep = "ORDER_MENU_ITEM";
      return "What menu item would you like to add?";
    }

    if (session.currentStep === "ORDER_MENU_ITEM") {
      const menuItemName = normalizedMsg;
      if (!menuItemName) return "What menu item would you like to add?";
      
      const menuResult: any = await executeTool("GET_MENU_ITEMS", {}, token);
      if (menuResult.error) return menuResult.message || "Unable to look up menu items.";
      
      const menuItems = Array.isArray(menuResult.data) ? menuResult.data : [];
      const menuItem = menuItems.find((m: any) => m.name && m.name.trim().toLowerCase() === menuItemName.toLowerCase());
      if (!menuItem) {
        return `Menu item "${menuItemName}" was not found.`;
      }
      
      session.collectedFields.pendingMenuItemId = menuItem.id || menuItem._id;
      session.collectedFields.pendingMenuItemName = menuItem.name;
      session.currentStep = "ORDER_QUANTITY";
      return `How many ${menuItem.name} would you like?`;
    }

    if (session.currentStep === "ORDER_QUANTITY") {
      const quantity = Number(normalizedMsg);
      if (isNaN(quantity) || quantity <= 0) {
        return `How many ${session.collectedFields.pendingMenuItemName} would you like?`;
      }
      
      session.collectedFields.items.push({
        menuItemId: session.collectedFields.pendingMenuItemId,
        quantity
      });
      
      delete session.collectedFields.pendingMenuItemId;
      delete session.collectedFields.pendingMenuItemName;
      session.currentStep = "ORDER_ADD_ANOTHER";
      return "Would you like to add another item? (Yes/No)";
    }

    if (session.currentStep === "ORDER_ADD_ANOTHER") {
      const answer = normalizedMsg.toLowerCase();
      if (answer === "yes" || answer === "y") {
        session.currentStep = "ORDER_MENU_ITEM";
        return "What menu item would you like to add?";
      } else if (answer === "no" || answer === "n") {
        // Validation check before calling CREATE_ORDER
        const tableId = session.collectedFields.tableId;
        const items = session.collectedFields.items || [];
        
        if (!tableId) {
          session.currentStep = "ORDER_TABLE";
          return "Validation failed: Missing table. Which table would you like to create the order for?";
        }
        if (items.length === 0) {
          session.currentStep = "ORDER_MENU_ITEM";
          return "Validation failed: No items selected. What menu item would you like to add?";
        }
        for (const item of items) {
          if (!item.menuItemId) {
            session.currentStep = "ORDER_MENU_ITEM";
            return "Validation failed: Missing menu item ID. What menu item would you like to add?";
          }
          if (typeof item.quantity !== "number" || isNaN(item.quantity) || item.quantity <= 0) {
            session.currentStep = "ORDER_QUANTITY";
            return "Validation failed: Quantity must be a positive number.";
          }
        }
        
        const result: any = await executeTool("CREATE_ORDER", { tableId, items }, token);
        resetOrderConversation(session);
        if (result.error) {
          return result.message || "Failed to create order";
        }
        
        // Refresh frontend
        await executeTool("GET_ORDER", {}, token);
        return "✅ Order created successfully.";
      } else {
        return "Would you like to add another item? (Yes/No)";
      }
    }
  }

  if (session.pendingTool === "UPDATE_ORDER") {
    if (session.currentStep === "ORDER_UPDATE_SELECT") {
      const orderNo = normalizedMsg;
      const orderList: any = await executeTool("GET_ORDER", {}, token);
      if (orderList.error) {
        resetOrderConversation(session);
        return "Unable to load orders.";
      }
      const order = (orderList.data || []).find((o: any) => normalizeOrderValue(o.orderNumber) === normalizeOrderValue(orderNo));
      if (!order) {
        return `Order "${orderNo}" was not found. Which order number would you like to update?`;
      }
      session.collectedFields.id = order.id || order._id;
      session.collectedFields.orderNumber = order.orderNumber;
      session.currentStep = "ORDER_UPDATE_STATUS";
      return "What status should be assigned? (PENDING, ACCEPTED, PREPARING, READY, SERVED, COMPLETED, CANCELLED)";
    }
    if (session.currentStep === "ORDER_UPDATE_STATUS") {
      const status = normalizedMsg.toUpperCase();
      if (!["PENDING", "ACCEPTED", "PREPARING", "READY", "SERVED", "COMPLETED", "CANCELLED"].includes(status)) {
        return "What status should be assigned? (PENDING, ACCEPTED, PREPARING, READY, SERVED, COMPLETED, CANCELLED)";
      }
      const result = await executeTool("UPDATE_ORDER", { id: session.collectedFields.id, status }, token);
      resetOrderConversation(session);
      if (result.error) return formatFriendlyError(result);
      return "✅ Order status updated successfully.";
    }
  }

  if (session.pendingTool === "DELETE_ORDER") {
    if (session.currentStep === "ORDER_DELETE_SELECT") {
      const orderNo = normalizedMsg;
      const orderList: any = await executeTool("GET_ORDER", {}, token);
      if (orderList.error) {
        resetOrderConversation(session);
        return "Unable to load orders.";
      }
      const order = (orderList.data || []).find((o: any) => normalizeOrderValue(o.orderNumber) === normalizeOrderValue(orderNo));
      if (!order) {
        return `Order "${orderNo}" was not found. Which order number would you like to delete?`;
      }
      session.collectedFields.id = order.id || order._id;
      session.collectedFields.orderNumber = order.orderNumber;
      session.currentStep = "ORDER_DELETE_CONFIRM";
      return `Are you sure you want to delete the order '${order.orderNumber}'? (Yes/No)`;
    }
    if (session.currentStep === "ORDER_DELETE_CONFIRM") {
      const answer = normalizedMsg.toLowerCase();
      if (answer === "yes" || answer === "y") {
        const result = await executeTool("DELETE_ORDER", { id: session.collectedFields.id }, token);
        resetOrderConversation(session);
        if (result.error) return formatFriendlyError(result);
        return "✅ Order deleted successfully.";
      } else if (answer === "no" || answer === "n") {
        resetOrderConversation(session);
        return "Operation cancelled.";
      } else {
        return `Are you sure you want to delete the order '${session.collectedFields.orderNumber}'? (Yes/No)`;
      }
    }
  }

  resetOrderConversation(session);
  return "Which table would you like to create the order for?";
}

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

  let handlerRes: string | null = null;

  if (session.pendingTool) {
    if (session.pendingTool.includes("CATEGORY")) {
      handlerRes = await handleCategoryConversation(message, session, token);
    } else if (session.pendingTool.includes("MENU_ITEM")) {
      handlerRes = await handleMenuConversation(message, session, token);
    } else if (session.pendingTool.includes("TABLE")) {
      handlerRes = await handleTableConversation(message, session, token);
    } else if (session.pendingTool.includes("ORDER")) {
      handlerRes = await handleOrderConversation(message, session, token);
    } else if (session.pendingTool.includes("ROLE")) {
      handlerRes = await handleRoleConversation(message, session, token);
    } else if (session.pendingTool.includes("USER")) {
      handlerRes = await handleUserConversation(message, session, token);
    } else if (session.pendingTool.includes("INVENTORY")) {
      handlerRes = await handleInventoryConversation(message, session, token);
    }
  } else {
    // Check regex matches to start a new conversation flow
    const normalizedMsg = String(message ?? "").trim();

    // Category regexes
    const startsCategoryCreate = /\b(create|add|new)\b.*\bcategory\b/i.test(normalizedMsg);
    const startsCategoryUpdate = /\b(update|edit|modify)\b.*\bcategory\b/i.test(normalizedMsg);
    const startsCategoryDelete = /\b(delete|remove)\b.*\bcategory\b/i.test(normalizedMsg);

    // Menu Item regexes
    const startsMenuCreate = /\b(create|add|new)\b.*\b(menu item|menu)\b/i.test(normalizedMsg);
    const startsMenuUpdate = /\b(update|edit|modify)\b.*\b(menu item|menu)\b/i.test(normalizedMsg);
    const startsMenuDelete = /\b(delete|remove)\b.*\b(menu item|menu)\b/i.test(normalizedMsg);

    // User regexes
    const startsUserCreate = /\b(create|add|new)\b.*\buser\b/i.test(normalizedMsg);
    const startsUserUpdate = /\b(update|edit|modify)\b.*\buser\b/i.test(normalizedMsg);
    const startsUserDelete = /\b(delete|remove)\b.*\buser\b/i.test(normalizedMsg);

    // Table regexes
    const startsTableCreate = /\b(create|add|new)\b.*\btable\b/i.test(normalizedMsg);
    const startsTableUpdate = /\b(update|edit|modify)\b.*\btable\b/i.test(normalizedMsg);
    const startsTableDelete = /\b(delete|remove)\b.*\btable\b/i.test(normalizedMsg);

    // Order regexes
    const startsOrderCreate = /\b(create|start|new|place)\b.*\border\b/i.test(normalizedMsg) || /\border\b.*\b(create|start|new|place)\b/i.test(normalizedMsg);
    const startsOrderUpdate = /\b(update|edit|modify)\b.*\border\b/i.test(normalizedMsg);
    const startsOrderDelete = /\b(delete|remove)\b.*\border\b/i.test(normalizedMsg);

    // Role regexes
    const startsRoleCreate = /\b(create|add|new)\b.*\brole\b/i.test(normalizedMsg);
    const startsRoleUpdate = /\b(update|edit|modify)\b.*\brole\b/i.test(normalizedMsg);
    const startsRoleDelete = /\b(delete|remove)\b.*\brole\b/i.test(normalizedMsg);

    // Inventory regexes
    const startsInventoryCreate = /\b(create|add|new)\b.*\binventory\b/i.test(normalizedMsg);
    const startsInventoryUpdate = /\b(update|edit|modify)\b.*\binventory\b/i.test(normalizedMsg);
    const startsInventoryDelete = /\b(delete|remove)\b.*\binventory\b/i.test(normalizedMsg);

    if (startsCategoryCreate || startsCategoryUpdate || startsCategoryDelete) {
      handlerRes = await handleCategoryConversation(message, session, token);
    } else if (startsMenuCreate || startsMenuUpdate || startsMenuDelete) {
      handlerRes = await handleMenuConversation(message, session, token);
    } else if (startsTableCreate || startsTableUpdate || startsTableDelete) {
      handlerRes = await handleTableConversation(message, session, token);
    } else if (startsOrderCreate || startsOrderUpdate || startsOrderDelete) {
      handlerRes = await handleOrderConversation(message, session, token);
    } else if (startsRoleCreate || startsRoleUpdate || startsRoleDelete) {
      handlerRes = await handleRoleConversation(message, session, token);
    } else if (startsUserCreate || startsUserUpdate || startsUserDelete) {
      handlerRes = await handleUserConversation(message, session, token);
    } else if (startsInventoryCreate || startsInventoryUpdate || startsInventoryDelete) {
      handlerRes = await handleInventoryConversation(message, session, token);
    }
  }

  if (handlerRes !== null) {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.write(`event: conversation_id\ndata: ${JSON.stringify({ conversationId: currentConvId })}\n\n`);
    res.write(`event: message\ndata: ${JSON.stringify({ content: handlerRes })}\n\n`);
    await prisma.chatMessage.create({
      data: { conversationId: currentConvId, role: "assistant", content: handlerRes }
    });
    res.write("event: done\ndata: {}\n\n");
    res.end();
    return;
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

      // Parse LLM conversational state output and persist it
      const collectedMatch = messageContent.match(/Collected Fields:\s*(\{.*\})/i);
      if (collectedMatch) {
         try {
            const parsed = JSON.parse(collectedMatch[1]);
            session!.collectedFields = { ...session!.collectedFields, ...parsed };
         } catch (e) {}
      }

      const intentMatch = messageContent.match(/Current Intent[^:]*:\s*([A-Z_]+)/i);
      if (intentMatch && intentMatch[1] !== "None") {
         session!.pendingTool = intentMatch[1];
      }

      const missingMatch = messageContent.match(/Missing Fields:\s*(\[.*\])/i);
      if (missingMatch) {
         try {
            session!.missingFields = JSON.parse(missingMatch[1]);
         } catch(e) {}
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
        let catalogMutationResponse = "";
        
        for (const toolCall of toolCalls) {
          const name = toolCall.function.name;
          let args = JSON.parse(toolCall.function.arguments || "{}");
          const prepareMenuToolArgs = async (name: string, a: any, t: string): Promise<{args: any, error?: string}> => ({ args: a });
          const isCatalogMutation = ["CREATE_CATEGORY", "UPDATE_CATEGORY", "DELETE_CATEGORY", "CREATE_MENU_ITEM", "UPDATE_MENU_ITEM", "DELETE_MENU_ITEM"].includes(name);
          const isCatalogTool = isCatalogMutation || ["GET_CATEGORIES", "GET_MENU_ITEMS"].includes(name);
          let result: any;
          if (isCatalogTool && !registeredToolNames.has(name)) {
            result = { error: true, message: `Tool '${name}' is unavailable.` };
          } else if (isCatalogTool) {
            const prepared = await prepareMenuToolArgs(name, args, token);
            if (prepared.error) {
              result = { error: true, message: prepared.error };
            } else {
              args = prepared.args;
              logger.info(`Before executeTool()`, { intent: name, tool: name, payload: args });
              logger.info("Selected intent", { intent: name });
              logger.info("Tool selection", { name });
              logger.info("Tool payload", { args });
              result = await executeTool(name, args, token);
            }
          } else {
            logger.info(`Before executeTool()`, { intent: name, tool: name, payload: args });
            logger.info("Selected intent", { intent: name });
            logger.info("Tool selection", { name });
            logger.info("Tool payload", { args });
            result = await executeTool(name, args, token);
          }
          
          logger.info(`After executeTool()`, { intent: name, tool: name, result, errors: result.error ? result : undefined });
          logger.info("Backend API response", { result });
          if (isCatalogMutation) {
            const labels: Record<string, string> = {
              CREATE_CATEGORY: "Category created",
              UPDATE_CATEGORY: "Category updated",
              DELETE_CATEGORY: "Category deleted",
              CREATE_MENU_ITEM: "Menu item created",
              UPDATE_MENU_ITEM: "Menu item updated",
              DELETE_MENU_ITEM: "Menu item deleted"
            };
            catalogMutationResponse = result.error ? (result.message || "Something went wrong.") : `✅ ${labels[name]} successfully.`;
          }
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
        if (catalogMutationResponse) {
          finalMessageContent = catalogMutationResponse;
          sendEvent("message", { content: catalogMutationResponse });
          isDone = true;
        }
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
