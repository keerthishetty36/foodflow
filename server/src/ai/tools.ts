import { env } from "../config.js";
import { logger, prisma } from "../lib.js";
import jwt from "jsonwebtoken";

// Utility to make internal authenticated requests
export async function internalFetch(path: string, method: string, token: string, body?: any) {
  const url = `http://localhost:${env.PORT || 5000}/api${path}`;
  const startTime = Date.now();
  try {
    logger.info("Before backend API", { method, path, payload: body });
    const res = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
        "Cookie": `accessToken=${token}`
      },
      body: body ? JSON.stringify(body) : undefined
    });
    
    let data;
    const text = await res.text();
    try { data = JSON.parse(text); } catch { data = text; }
    
    logger.info("After backend API", { method, path, status: res.status, response: data });

    if (!res.ok) {
      return { error: true, status: res.status, message: data?.message || data || "Unknown API error", details: data?.errors };
    }
    return { success: true, data: data?.data || data };
  } catch (error: any) {
    const executionTimeMs = Date.now() - startTime;
    logger.error("Internal fetch failed", { url, method, payload: body, error: error.message, stack: error.stack, executionTimeMs });

    return { error: true, message: error.message || String(error) };
  }
}

export const toolDefinitions: any[] = [
  // Dashboard & Reports
  { type: "function", function: { name: "GET_DASHBOARD", description: "Get dashboard stats (today sales, running orders, low stock)", parameters: { type: "object", properties: {}, required: [] } } },
  { type: "function", function: { name: "GET_SALES_REPORT", description: "Get sales report", parameters: { type: "object", properties: { from: { type: "string", description: "Date string (e.g., 2026-08-01)" } }, required: [] } } },

  // Tables
  { type: "function", function: { name: "CREATE_TABLE", description: "Create a table", parameters: { type: "object", properties: { name: { type: "string" }, capacity: { type: "string", description: "Table capacity (e.g. '10')" }, status: { type: "string", enum: ["AVAILABLE", "OCCUPIED", "RESERVED", "CLEANING", "MAINTENANCE"] } }, required: ["name", "capacity", "status"] } } },
  { type: "function", function: { name: "LIST_TABLES", description: "List tables", parameters: { type: "object", properties: {}, required: [] } } },
  { type: "function", function: { name: "UPDATE_TABLE", description: "Update a table", parameters: { type: "object", properties: { name: { type: "string", description: "Current name" }, newName: { type: "string", description: "New name if renaming" }, capacity: { type: "string", description: "Table capacity (e.g. '10')" }, status: { type: "string", enum: ["AVAILABLE", "OCCUPIED", "RESERVED", "CLEANING", "MAINTENANCE"] } }, required: ["name"] } } },
  { type: "function", function: { name: "RENAME_TABLE", description: "Rename a table", parameters: { type: "object", properties: { name: { type: "string", description: "Current name" }, newName: { type: "string" } }, required: ["name", "newName"] } } },
  { type: "function", function: { name: "CHANGE_TABLE_STATUS", description: "Change table status", parameters: { type: "object", properties: { name: { type: "string", description: "Table name" }, status: { type: "string", enum: ["AVAILABLE", "OCCUPIED", "RESERVED", "CLEANING", "MAINTENANCE"] } }, required: ["name", "status"] } } },
  { type: "function", function: { name: "DELETE_TABLE", description: "Delete a table", parameters: { type: "object", properties: { name: { type: "string" } }, required: ["name"] } } },

  // Categories
  { type: "function", function: { name: "CREATE_CATEGORY", description: "Create a category", parameters: { type: "object", properties: { name: { type: "string" }, description: { type: "string" }, active: { type: "boolean" } }, required: ["name"], additionalProperties: false } } },
  { type: "function", function: { name: "GET_CATEGORIES", description: "List categories", parameters: { type: "object", properties: {}, required: [] } } },
  { type: "function", function: { name: "UPDATE_CATEGORY", description: "Update a category", parameters: { type: "object", properties: { name: { type: "string", description: "Current name" }, newName: { type: "string" }, description: { type: "string" }, active: { type: "boolean" } }, required: ["name"], additionalProperties: false } } },
  { type: "function", function: { name: "DELETE_CATEGORY", description: "Delete a category", parameters: { type: "object", properties: { name: { type: "string" } }, required: ["name"], additionalProperties: false } } },

  // Menu Items
  { type: "function", function: { name: "CREATE_MENU_ITEM", description: "Create a menu item", parameters: { type: "object", properties: { name: { type: "string" }, categoryId: { type: "string" }, costPrice: { type: "number" }, price: { type: "number" }, vegType: { type: "string", enum: ["VEG", "NON_VEG", "EGG"] } }, required: ["name", "categoryId", "costPrice", "price", "vegType"], additionalProperties: false } } },
  { type: "function", function: { name: "GET_MENU_ITEMS", description: "List menu items", parameters: { type: "object", properties: {}, required: [] } } },
  { type: "function", function: { name: "UPDATE_MENU_ITEM", description: "Update a menu item", parameters: { type: "object", properties: { name: { type: "string" }, newName: { type: "string" }, price: { type: "number" }, costPrice: { type: "number" }, categoryId: { type: "string" }, vegType: { type: "string", enum: ["VEG", "NON_VEG", "EGG"] } }, required: ["name"], additionalProperties: false } } },
  { type: "function", function: { name: "DELETE_MENU_ITEM", description: "Delete a menu item", parameters: { type: "object", properties: { name: { type: "string" } }, required: ["name"] } } },

  // Users
  { type: "function", function: { name: "CREATE_USER", description: "Create a user", parameters: { type: "object", properties: { name: { type: "string" }, email: { type: "string" }, password: { type: "string" }, role: { type: "string", description: "The role name (e.g., Kitchen Staff, Admin)" } }, required: ["name", "email", "password", "role"] } } },
  { type: "function", function: { name: "GET_USER", description: "List users", parameters: { type: "object", properties: {}, required: [] } } },
  { type: "function", function: { name: "GET_USERS", description: "List users", parameters: { type: "object", properties: {}, required: [] } } },
  { type: "function", function: { name: "UPDATE_USER", description: "Update a user", parameters: { type: "object", properties: { email: { type: "string", description: "Current user email" }, newName: { type: "string" }, active: { type: "boolean" }, role: { type: "string", description: "New role name" } }, required: ["email"] } } },
  { type: "function", function: { name: "DELETE_USER", description: "Delete a user", parameters: { type: "object", properties: { email: { type: "string" } }, required: ["email"] } } },

  // Roles
  { type: "function", function: { name: "CREATE_ROLE", description: "Create a role", parameters: { type: "object", properties: { name: { type: "string" }, description: { type: "string" }, permissions: { type: "array", items: { type: "string" }, description: "List of permission strings (e.g., users.view, pos.bill)" } }, required: ["name", "permissions"] } } },
  { type: "function", function: { name: "GET_ROLES", description: "List roles", parameters: { type: "object", properties: {}, required: [] } } },
  { type: "function", function: { name: "UPDATE_ROLE", description: "Update a role or assign permissions", parameters: { type: "object", properties: { name: { type: "string", description: "Current role name" }, newName: { type: "string" }, permissions: { type: "array", items: { type: "string" } } }, required: ["name"] } } },
  { type: "function", function: { name: "DELETE_ROLE", description: "Delete a role", parameters: { type: "object", properties: { roleId: { type: "string" } }, required: ["roleId"] } } },

  // Suppliers
  { type: "function", function: { name: "CREATE_SUPPLIER", description: "Create supplier", parameters: { type: "object", properties: { name: { type: "string" }, phone: { type: "string" }, email: { type: "string" }, address: { type: "string" } }, required: ["name"] } } },
  { type: "function", function: { name: "GET_SUPPLIER", description: "List suppliers", parameters: { type: "object", properties: {}, required: [] } } },
  { type: "function", function: { name: "UPDATE_SUPPLIER", description: "Update supplier", parameters: { type: "object", properties: { name: { type: "string" }, newName: { type: "string" }, phone: { type: "string" } }, required: ["name"] } } },
  { type: "function", function: { name: "DELETE_SUPPLIER", description: "Delete supplier", parameters: { type: "object", properties: { name: { type: "string" } }, required: ["name"] } } },

  // Inventory
  { type: "function", function: { name: "CREATE_INVENTORY", description: "Add inventory", parameters: { type: "object", properties: { name: { type: "string" }, unit: { type: "string" }, quantity: { type: "number" }, reorderLevel: { type: "number" } }, required: ["name", "unit", "quantity", "reorderLevel"] } } },
  { type: "function", function: { name: "GET_INVENTORY", description: "List inventory items", parameters: { type: "object", properties: {}, required: [] } } },
  { type: "function", function: { name: "UPDATE_INVENTORY", description: "Update inventory", parameters: { type: "object", properties: { name: { type: "string" }, quantity: { type: "number" } }, required: ["name"] } } },
  { type: "function", function: { name: "DELETE_INVENTORY", description: "Delete inventory", parameters: { type: "object", properties: { name: { type: "string" } }, required: ["name"] } } },

  // Orders
  { type: "function", function: { name: "CREATE_ORDER", description: "Create order", parameters: { type: "object", properties: { tableName: { type: "string" }, items: { type: "array", items: { type: "object", properties: { menuItemName: { type: "string" }, quantity: { type: "number" } }, required: ["menuItemName", "quantity"] } } }, required: ["items"] } } },
  { type: "function", function: { name: "GET_ORDER", description: "List orders", parameters: { type: "object", properties: { status: { type: "string" } }, required: [] } } },
  { type: "function", function: { name: "UPDATE_ORDER", description: "Update order status", parameters: { type: "object", properties: { orderNumber: { type: "string" }, status: { type: "string", enum: ["PENDING", "ACCEPTED", "PREPARING", "READY", "SERVED", "COMPLETED", "CANCELLED"] } }, required: ["orderNumber", "status"] } } },
  { type: "function", function: { name: "CANCEL_ORDER", description: "Cancel order", parameters: { type: "object", properties: { orderNumber: { type: "string" } }, required: ["orderNumber"] } } },
  { type: "function", function: { name: "DELETE_ORDER", description: "Delete order", parameters: { type: "object", properties: { orderNumber: { type: "string" } }, required: ["orderNumber"] } } }
];

function normalizeStr(str: string) {
  if (!str) return "";
  return String(str).trim().replace(/\s+/g, ' ').toLowerCase();
}

function levenshteinDistance(a: string, b: string) {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix = [];
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) == a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(matrix[i - 1][j - 1] + 1, Math.min(matrix[i][j - 1] + 1, matrix[i - 1][j] + 1));
      }
    }
  }
  return matrix[b.length][a.length];
}

async function resolveId(endpoint: string, searchKey: string, searchValue: string, token: string): Promise<any> {
  const res: any = await internalFetch(endpoint, "GET", token);
  if (res.error) return res;
  const items = res.data || [];
  
  const normSearch = normalizeStr(searchValue);
  
  // 1. Exact Normalized Match
  const exactMatch = items.find((i: any) => normalizeStr(i[searchKey]) === normSearch);
  if (exactMatch) return { success: true, id: exactMatch.id };
  
  // 2. Fuzzy Match
  const matches = items.map((i: any) => {
     const normItem = normalizeStr(i[searchKey]);
     const distance = levenshteinDistance(normItem, normSearch);
     return { item: i, distance, name: i[searchKey] };
  }).filter((m: any) => m.distance <= 3).sort((a: any, b: any) => a.distance - b.distance);
  
  if (matches.length === 1) {
     return { error: true, message: `Did you mean '${matches[0].name}'?` };
  } else if (matches.length > 1) {
     const names = matches.map((m: any) => `'${m.name}'`).join(", ");
     return { error: true, message: `I couldn't find '${searchValue}'. Did you mean one of these: ${names}?` };
  }
  
  return { error: true, message: `I couldn't find '${searchValue}'. Please enter a valid menu item.` };
}

const permissionMapping: Record<string, string> = {
  CREATE_TABLE: "tables.create",
  UPDATE_TABLE: "tables.update",
  DELETE_TABLE: "tables.delete",
  READ_TABLE: "tables.view",
  LIST_TABLES: "tables.view",
  RENAME_TABLE: "tables.update",
  CHANGE_TABLE_STATUS: "tables.update",
  GET_TABLE: "tables.view",

  CREATE_CATEGORY: "categories.create",
  UPDATE_CATEGORY: "categories.update",
  DELETE_CATEGORY: "categories.delete",
  READ_CATEGORY: "categories.read",
  GET_CATEGORIES: "categories.read",

  CREATE_MENU_ITEM: "menu.create",
  UPDATE_MENU_ITEM: "menu.update",
  DELETE_MENU_ITEM: "menu.delete",
  READ_MENU_ITEM: "menu.read",
  GET_MENU_ITEMS: "menu.read",

  CREATE_ORDER: "orders.create",
  UPDATE_ORDER: "orders.update",
  DELETE_ORDER: "orders.delete",
  READ_ORDER: "orders.view",
  GET_ORDER: "orders.view",
  CANCEL_ORDER: "orders.delete",

  CREATE_INVENTORY: "inventory.create",
  UPDATE_INVENTORY: "inventory.update",
  DELETE_INVENTORY: "inventory.delete",
  GET_INVENTORY: "inventory.view",

  CREATE_USER: "users.create",
  UPDATE_USER: "users.update",
  DELETE_USER: "users.delete",
  GET_USER: "users.view",
  GET_USERS: "users.view",

  CREATE_ROLE: "roles.create",
  UPDATE_ROLE: "roles.update",
  DELETE_ROLE: "roles.delete",
  GET_ROLES: "roles.view",

  GET_SALES_REPORT: "reports.view",

  GET_DASHBOARD: "dashboard.view",
  
  CREATE_SUPPLIER: "suppliers.create",
  UPDATE_SUPPLIER: "suppliers.update",
  DELETE_SUPPLIER: "suppliers.delete",
  GET_SUPPLIER: "suppliers.view",
};

export async function checkChatbotPermission(token: string, toolName: string) {
  const required = permissionMapping[toolName];
  if (!required) return true;
  
  try {
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as any;
    const user = await prisma.user.findUnique({ where: { id: payload.sub }, include: { customRole: true } });
    if (!user) return false;
    const permissions = user.customRole?.permissions || (user.role === "ADMIN" ? ["*"] : []);
    if (permissions.includes("*")) return true;
    return permissions.includes(required);
  } catch (error) {
    logger.warn("Chatbot permission check failed", { error: String(error) });
    return false;
  }
}

export async function executeTool(name: string, args: any, token: string) {
  const hasPermission = await checkChatbotPermission(token, name);
  if (!hasPermission) {
    return { error: true, status: 403, message: "❌ You don't have permission to perform this action." };
  }

  switch (name) {
    case "GET_DASHBOARD":
      return internalFetch("/dashboard", "GET", token);
    case "GET_SALES_REPORT":
      return internalFetch(`/reports/sales${args.from ? `?from=${args.from}` : ""}`, "GET", token);

    // Categories
    case "CREATE_CATEGORY":
      return internalFetch("/categories", "POST", token, args);
    case "GET_CATEGORIES":
      return internalFetch("/categories", "GET", token);
    case "UPDATE_CATEGORY": {
      const { id, ...payload } = args;
      return internalFetch(`/categories/${id}`, "PATCH", token, payload);
    }
    case "DELETE_CATEGORY":
      return internalFetch(`/categories/${args.id}`, "DELETE", token);

    // Menu Items
    case "CREATE_MENU_ITEM":
      return internalFetch("/menu-items", "POST", token, args);
    case "GET_MENU_ITEMS":
      return internalFetch("/menu-items", "GET", token);
    case "UPDATE_MENU_ITEM": {
      const { id, ...payload } = args;
      return internalFetch(`/menu-items/${id}`, "PATCH", token, payload);
    }
    case "DELETE_MENU_ITEM":
      return internalFetch(`/menu-items/${args.id}`, "DELETE", token);

    // Tables
    case "CREATE_TABLE":
      return internalFetch("/tables", "POST", token, args);
    case "GET_TABLE":
    case "LIST_TABLES":
      return internalFetch("/tables", "GET", token);
    case "UPDATE_TABLE": {
      const { id, ...payload } = args;
      return internalFetch(`/tables/${id}`, "PATCH", token, payload);
    }
    case "DELETE_TABLE":
      return internalFetch(`/tables/${args.id}`, "DELETE", token);

    // Orders
    case "CREATE_ORDER":
      return internalFetch("/orders", "POST", token, args);
    case "GET_ORDER":
      return internalFetch(`/orders${args.status ? `?status=${args.status}` : ""}`, "GET", token);
    case "UPDATE_ORDER": {
      const { id, ...payload } = args;
      return internalFetch(`/orders/${id}/status`, "PATCH", token, payload);
    }
    case "DELETE_ORDER":
      return internalFetch(`/orders/${args.id}`, "DELETE", token);

    // Roles
    case "CREATE_ROLE":
      return internalFetch("/roles", "POST", token, args);
    case "GET_ROLES":
      return internalFetch("/roles", "GET", token);
    case "UPDATE_ROLE": {
      const { id, ...payload } = args;
      return internalFetch(`/roles/${id}`, "PATCH", token, payload);
    }
    case "DELETE_ROLE": {
      const id = args.roleId || args.id;
      return internalFetch(`/roles/${id}`, "DELETE", token);
    }

    // Users
    case "CREATE_USER":
      return internalFetch("/users", "POST", token, args);
    case "GET_USER":
    case "GET_USERS":
      return internalFetch("/users", "GET", token);
    case "UPDATE_USER": {
      const { id, ...payload } = args;
      return internalFetch(`/users/${id}`, "PATCH", token, payload);
    }
    case "DELETE_USER":
      return internalFetch(`/users/${args.id}`, "DELETE", token);

    // Inventory
    case "CREATE_INVENTORY":
      return internalFetch("/inventory", "POST", token, args);
    case "GET_INVENTORY":
      return internalFetch("/inventory", "GET", token);
    case "UPDATE_INVENTORY": {
      const { id, ...payload } = args;
      return internalFetch(`/inventory/${id}`, "PATCH", token, payload);
    }
    case "DELETE_INVENTORY":
      return internalFetch(`/inventory/${args.id}`, "DELETE", token);

    // Suppliers
    case "CREATE_SUPPLIER":
      return internalFetch("/suppliers", "POST", token, args);
    case "GET_SUPPLIER":
      return internalFetch("/suppliers", "GET", token);
    case "UPDATE_SUPPLIER": {
      const { id, ...payload } = args;
      return internalFetch(`/suppliers/${id}`, "PATCH", token, payload);
    }
    case "DELETE_SUPPLIER":
      return internalFetch(`/suppliers/${args.id}`, "DELETE", token);

    default:
      return { error: true, message: `Tool ${name} is not registered or automatically mapped.` };
  }
}
