import { env } from "../config.js";
import { logger } from "../lib.js";

// Utility to make internal authenticated requests
export async function internalFetch(path: string, method: string, token: string, body?: any) {
  const url = `http://localhost:${env.PORT}/api${path}`;
  try {
    const res = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        "Cookie": `accessToken=${token}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    
    // Attempt to parse JSON regardless of status
    let data;
    const text = await res.text();
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }

    if (!res.ok) {
      return { error: true, status: res.status, message: data?.message || data || "Unknown API error" };
    }
    return { success: true, data: data?.data || data };
  } catch (error) {
    logger.error("Internal fetch failed", { path, error });
    return { error: true, message: error instanceof Error ? error.message : String(error) };
  }
}

// Map of tool definitions for Groq API
export const toolDefinitions: any[] = [
  {
    type: "function",
    function: {
      name: "getDashboardStats",
      description: "Get today's sales, running orders, low stock items, and recent orders. Call this when asked for a report, sales, or overview.",
      parameters: { type: "object", properties: {}, required: [] }
    }
  },
  {
    type: "function",
    function: {
      name: "createUser",
      description: "Create a new user (admin, cashier, kitchen staff, etc.). Ask the user for name, email, password, and role before calling this.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          email: { type: "string" },
          password: { type: "string" },
          roleId: { type: "string", description: "The ID of the role to assign to the user. Call getRoles() first to find the correct roleId." }
        },
        required: ["name", "email", "password", "roleId"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "getUsers",
      description: "Get a list of all users.",
      parameters: { type: "object", properties: {}, required: [] }
    }
  },
  {
    type: "function",
    function: {
      name: "getRoles",
      description: "Get a list of all custom roles and their IDs. Use this before assigning a role ID to a user.",
      parameters: { type: "object", properties: {}, required: [] }
    }
  },
  {
    type: "function",
    function: {
      name: "createMenuItem",
      description: "Create a new menu item. Ask for name, price, category, and type before calling.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          price: { type: "number" },
          costPrice: { type: "number" },
          categoryId: { type: "string" },
          description: { type: "string" },
          type: { type: "string", enum: ["VEG", "NON_VEG", "VEGAN"] },
          active: { type: "boolean" }
        },
        required: ["name", "price", "categoryId", "type"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "getCategories",
      description: "Get a list of all menu categories and their IDs. Use this before creating a menu item to find the correct categoryId.",
      parameters: { type: "object", properties: {}, required: [] }
    }
  },
  {
    type: "function",
    function: {
      name: "getInventory",
      description: "Get a list of all inventory items and their quantities. Useful for finding low stock.",
      parameters: { type: "object", properties: {}, required: [] }
    }
  },
  {
    type: "function",
    function: {
      name: "addInventoryItem",
      description: "Add a new inventory item.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          sku: { type: "string" },
          unit: { type: "string" },
          quantity: { type: "number" },
          reorderLevel: { type: "number" }
        },
        required: ["name", "unit", "quantity", "reorderLevel"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "getSuppliers",
      description: "Get a list of all suppliers.",
      parameters: { type: "object", properties: {}, required: [] }
    }
  }
];

// Execute the tool and map it to an API path
export async function executeTool(name: string, args: any, token: string) {
  switch (name) {
    case "getDashboardStats": return internalFetch("/dashboard", "GET", token);
    case "createUser": return internalFetch("/users", "POST", token, args);
    case "getUsers": return internalFetch("/users", "GET", token);
    case "getRoles": return internalFetch("/roles", "GET", token);
    case "createMenuItem": return internalFetch("/menu", "POST", token, args);
    case "getCategories": return internalFetch("/categories", "GET", token);
    case "getInventory": return internalFetch("/inventory", "GET", token);
    case "addInventoryItem": return internalFetch("/inventory", "POST", token, args);
    case "getSuppliers": return internalFetch("/suppliers", "GET", token);
    default: return { error: true, message: `Tool ${name} not found.` };
  }
}
