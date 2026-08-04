import { env } from "../config.js";
import { logger } from "../lib.js";

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
  { type: "function", function: { name: "UPDATE_TABLE", description: "Update a table", parameters: { type: "object", properties: { name: { type: "string", description: "Current name" }, capacity: { type: "string", description: "Table capacity (e.g. '10')" }, status: { type: "string", enum: ["AVAILABLE", "OCCUPIED", "RESERVED", "CLEANING", "MAINTENANCE"] } }, required: ["name"] } } },
  { type: "function", function: { name: "RENAME_TABLE", description: "Rename a table", parameters: { type: "object", properties: { name: { type: "string", description: "Current name" }, newName: { type: "string" } }, required: ["name", "newName"] } } },
  { type: "function", function: { name: "CHANGE_TABLE_STATUS", description: "Change table status", parameters: { type: "object", properties: { name: { type: "string", description: "Table name" }, status: { type: "string", enum: ["AVAILABLE", "OCCUPIED", "RESERVED", "CLEANING", "MAINTENANCE"] } }, required: ["name", "status"] } } },
  { type: "function", function: { name: "DELETE_TABLE", description: "Delete a table", parameters: { type: "object", properties: { name: { type: "string" } }, required: ["name"] } } },

  // Categories
  { type: "function", function: { name: "CREATE_CATEGORY", description: "Create a category", parameters: { type: "object", properties: { name: { type: "string" }, description: { type: "string", description: "Category description (optional)" }, active: { type: "boolean", description: "Whether the category is active (Yes/No)" } }, required: ["name", "description", "active"] } } },
  { type: "function", function: { name: "GET_CATEGORY", description: "List categories", parameters: { type: "object", properties: {}, required: [] } } },
  { type: "function", function: { name: "UPDATE_CATEGORY", description: "Update a category", parameters: { type: "object", properties: { name: { type: "string", description: "Current name" }, newName: { type: "string" }, description: { type: "string" }, active: { type: "boolean" } }, required: ["name"] } } },
  { type: "function", function: { name: "DELETE_CATEGORY", description: "Delete a category", parameters: { type: "object", properties: { name: { type: "string" } }, required: ["name"] } } },

  // Menu Items
  { type: "function", function: { name: "CREATE_MENU", description: "Create a menu item", parameters: { type: "object", properties: { name: { type: "string" }, price: { type: "number" }, costPrice: { type: "number" }, categoryName: { type: "string" }, vegType: { type: "string", enum: ["VEG", "NON_VEG", "EGG"] }, preparationTime: { type: "number", description: "Preparation time in minutes" }, available: { type: "boolean", description: "Whether it is available (Yes/No)" }, description: { type: "string", description: "Description (optional)" } }, required: ["name", "categoryName", "price", "costPrice", "vegType", "preparationTime", "description", "available"] } } },
  { type: "function", function: { name: "GET_MENU", description: "List menu items", parameters: { type: "object", properties: {}, required: [] } } },
  { type: "function", function: { name: "UPDATE_MENU", description: "Update a menu item", parameters: { type: "object", properties: { name: { type: "string" }, newName: { type: "string" }, price: { type: "number" }, costPrice: { type: "number" }, available: { type: "boolean" } }, required: ["name"] } } },
  { type: "function", function: { name: "DELETE_MENU", description: "Delete a menu item", parameters: { type: "object", properties: { name: { type: "string" } }, required: ["name"] } } },

  // Users
  { type: "function", function: { name: "CREATE_USER", description: "Create a user", parameters: { type: "object", properties: { name: { type: "string" }, email: { type: "string" }, password: { type: "string" }, role: { type: "string", description: "The role name (e.g., Kitchen Staff, Admin)" } }, required: ["name", "email", "password", "role"] } } },
  { type: "function", function: { name: "GET_USER", description: "List users", parameters: { type: "object", properties: {}, required: [] } } },
  { type: "function", function: { name: "UPDATE_USER", description: "Update a user", parameters: { type: "object", properties: { email: { type: "string", description: "Current user email" }, newName: { type: "string" }, active: { type: "boolean" }, role: { type: "string", description: "New role name" } }, required: ["email"] } } },
  { type: "function", function: { name: "DELETE_USER", description: "Delete a user", parameters: { type: "object", properties: { email: { type: "string" } }, required: ["email"] } } },

  // Roles
  { type: "function", function: { name: "CREATE_ROLE", description: "Create a role", parameters: { type: "object", properties: { name: { type: "string" }, description: { type: "string" }, permissions: { type: "array", items: { type: "string" }, description: "List of permission strings (e.g., users.view, pos.bill)" } }, required: ["name", "permissions"] } } },
  { type: "function", function: { name: "GET_ROLE", description: "List roles", parameters: { type: "object", properties: {}, required: [] } } },
  { type: "function", function: { name: "UPDATE_ROLE", description: "Update a role or assign permissions", parameters: { type: "object", properties: { name: { type: "string", description: "Current role name" }, newName: { type: "string" }, permissions: { type: "array", items: { type: "string" } } }, required: ["name"] } } },
  { type: "function", function: { name: "DELETE_ROLE", description: "Delete a role", parameters: { type: "object", properties: { name: { type: "string" } }, required: ["name"] } } },

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

async function resolveId(endpoint: string, searchKey: string, searchValue: string, token: string): Promise<any> {
  const res: any = await internalFetch(endpoint, "GET", token);
  if (res.error) return res;
  const items = res.data || [];
  const match = items.find((i: any) => i[searchKey]?.toLowerCase() === searchValue.toLowerCase());
  if (!match) return { error: true, message: `${searchKey} '${searchValue}' not found.` };
  return { success: true, id: match.id };
}

export async function executeTool(name: string, args: any, token: string) {
  switch (name) {
    case "GET_DASHBOARD": return internalFetch("/dashboard", "GET", token);
    case "GET_SALES_REPORT": return internalFetch(`/reports/sales${args.from ? `?from=${args.from}` : ""}`, "GET", token);

    case "GET_TABLE": return internalFetch("/tables", "GET", token);
    case "CREATE_TABLE": return internalFetch("/tables", "POST", token, args);
    case "UPDATE_TABLE": {
      const idRes: any = await resolveId("/tables", "name", args.name, token);
      if (idRes.error) return idRes;
      const { name, newName, ...rest } = args;
      return internalFetch(`/tables/${idRes.id}`, "PATCH", token, { ...rest, name: newName || name });
    }
    case "DELETE_TABLE": {
      const idRes: any = await resolveId("/tables", "name", args.name, token);
      if (idRes.error) return idRes;
      return internalFetch(`/tables/${idRes.id}`, "DELETE", token);
    }
    
    case "GET_CATEGORY": return internalFetch("/categories", "GET", token);
    case "CREATE_CATEGORY": return internalFetch("/categories", "POST", token, args);
    case "UPDATE_CATEGORY": {
      const idRes: any = await resolveId("/categories", "name", args.name, token);
      if (idRes.error) return idRes;
      const { name, newName, ...rest } = args;
      return internalFetch(`/categories/${idRes.id}`, "PATCH", token, { ...rest, name: newName || name });
    }
    case "DELETE_CATEGORY": {
      const idRes: any = await resolveId("/categories", "name", args.name, token);
      if (idRes.error) return idRes;
      return internalFetch(`/categories/${idRes.id}`, "DELETE", token);
    }

    case "GET_MENU": return internalFetch("/menu-items", "GET", token);
    case "CREATE_MENU": {
      const catRes: any = await resolveId("/categories", "name", args.categoryName, token);
      if (catRes.error) return catRes;
      const newArgs = { ...args, categoryId: catRes.id };
      delete newArgs.categoryName;
      return internalFetch("/menu-items", "POST", token, newArgs);
    }
    case "UPDATE_MENU": {
      const idRes: any = await resolveId("/menu-items", "name", args.name, token);
      if (idRes.error) return idRes;
      const { name, newName, ...rest } = args;
      return internalFetch(`/menu-items/${idRes.id}`, "PATCH", token, { ...rest, name: newName || name });
    }
    case "DELETE_MENU": {
      const idRes: any = await resolveId("/menu-items", "name", args.name, token);
      if (idRes.error) return idRes;
      return internalFetch(`/menu-items/${idRes.id}`, "DELETE", token);
    }

    case "GET_USER": return internalFetch("/users", "GET", token);
    case "CREATE_USER": {
      const newArgs = { ...args };
      try {
        if (newArgs.role) {
          const standardRoles = ["ADMIN", "MANAGER", "CASHIER", "KITCHEN", "WAITER"];
          const uppercaseRole = String(newArgs.role).toUpperCase();

          if (standardRoles.includes(uppercaseRole)) {
            newArgs.role = uppercaseRole;
          } else {
            const roleRes: any = await internalFetch("/roles", "GET", token);
            if (roleRes.error) return roleRes;
            
            const matches = (roleRes.data || []).filter((r: any) => {
              if (!r.name) return false;
              return r.name.toLowerCase().includes(String(newArgs.role).toLowerCase()) || 
                     r.displayName?.toLowerCase().includes(String(newArgs.role).toLowerCase());
            });
            
            if (matches.length === 0) {
              return { error: true, status: 404, message: `I couldn't find a role named '${newArgs.role}'.` };
            }
            if (matches.length > 1) {
              const exactMatch = matches.find((r: any) => 
                r.name.toLowerCase() === String(newArgs.role).toLowerCase() || 
                r.displayName?.toLowerCase() === String(newArgs.role).toLowerCase()
              );
              if (exactMatch) {
                newArgs.roleId = exactMatch.id;
              } else {
                return { error: true, status: 400, message: `Multiple roles match "${newArgs.role}": ${matches.map((r:any) => r.name).join(", ")}. Please specify which one you mean.` };
              }
            } else {
              newArgs.roleId = matches[0].id;
            }
            delete newArgs.role; // don't send both baseRole and roleId
          }
        }
        return await internalFetch("/users", "POST", token, newArgs);
      } catch (e: any) {
        logger.error("Error creating user", { toolName: "CREATE_USER", payload: args, error: e.message, stack: e.stack });
        return { error: true, status: 500, message: e.message || String(e) };
      }
    }
    case "UPDATE_USER": {
      const idRes: any = await resolveId("/users", "email", args.email, token);
      if (idRes.error) return idRes;
      const newArgs = { ...args };
      if (newArgs.role) {
        const roleRes: any = await internalFetch("/roles", "GET", token);
        if (roleRes.error) return roleRes;
        
        const matches = (roleRes.data || []).filter((r: any) => 
           r.name.toLowerCase().includes(newArgs.role.toLowerCase()) || 
           r.displayName?.toLowerCase().includes(newArgs.role.toLowerCase())
        );
        
        if (matches.length === 0) {
          return { error: true, status: 404, message: "I couldn't find that role. Would you like me to create it first?" };
        }
        if (matches.length > 1) {
          const exactMatch = matches.find((r: any) => r.name.toLowerCase() === newArgs.role.toLowerCase() || r.displayName?.toLowerCase() === newArgs.role.toLowerCase());
          if (exactMatch) {
             newArgs.roleId = exactMatch.id;
          } else {
             return { error: true, status: 400, message: `Multiple roles match "${newArgs.role}": ${matches.map((r:any) => r.name).join(", ")}. Please specify which one you mean.` };
          }
        } else {
          newArgs.roleId = matches[0].id;
        }
        delete newArgs.role;
      }
      const { email, newName, ...rest } = newArgs;
      return internalFetch(`/users/${idRes.id}`, "PATCH", token, { ...rest, name: newName });
    }
    case "DELETE_USER": {
      const idRes: any = await resolveId("/users", "email", args.email, token);
      if (idRes.error) return idRes;
      return internalFetch(`/users/${idRes.id}`, "DELETE", token);
    }
    
    // -- TABLES --
    case "LIST_TABLES":
    case "GET_TABLE": 
      return internalFetch("/tables", "GET", token);
      
    case "CREATE_TABLE": {
      let { name, capacity, status } = args;
      if (!name || !capacity || !status) {
        return { error: true, status: 400, message: "Missing required fields: name, capacity, status" };
      }
      capacity = Number(capacity);
      if (isNaN(capacity)) {
        return { error: true, status: 400, message: "What should the seating capacity be?" };
      }

      status = String(status).toUpperCase();
      if (status === "MAINTENANCE") status = "CLEANING"; // Map to backend enum
      
      const payload = { name, capacity, status };
      return internalFetch("/tables", "POST", token, payload);
    }
    
    case "UPDATE_TABLE":
    case "RENAME_TABLE":
    case "CHANGE_TABLE_STATUS": {
      const idRes: any = await resolveId("/tables", "name", args.name, token);
      if (idRes.error) return idRes;
      
      const payload: any = {};
      if (args.newName) payload.name = args.newName;
      if (args.capacity !== undefined) {
        payload.capacity = Number(args.capacity);
        if (isNaN(payload.capacity)) {
          return { error: true, status: 400, message: "What should the seating capacity be?" };
        }
      }
      if (args.status) {
        let st = String(args.status).toUpperCase();
        if (st === "MAINTENANCE") st = "CLEANING";
        payload.status = st;
      }
      
      return internalFetch(`/tables/${idRes.id}`, "PATCH", token, payload);
    }
    
    case "DELETE_TABLE": {
      const idRes: any = await resolveId("/tables", "name", args.name, token);
      if (idRes.error) return idRes;
      return internalFetch(`/tables/${idRes.id}`, "DELETE", token);
    }

    // -- ROLES --
    case "GET_ROLE": return internalFetch("/roles", "GET", token);
    case "CREATE_ROLE": return internalFetch("/roles", "POST", token, args);
    case "UPDATE_ROLE": {
      const idRes: any = await resolveId("/roles", "name", args.name, token);
      if (idRes.error) return idRes;
      const { name, newName, ...rest } = args;
      return internalFetch(`/roles/${idRes.id}`, "PATCH", token, { ...rest, name: newName || name });
    }
    case "DELETE_ROLE": {
      const idRes: any = await resolveId("/roles", "name", args.name, token);
      if (idRes.error) return idRes;
      return internalFetch(`/roles/${idRes.id}`, "DELETE", token);
    }
    
    case "CREATE_MENU": {
      const newArgs = { ...args };
      if (newArgs.categoryName) {
        const catRes: any = await resolveId("/categories", "name", newArgs.categoryName, token);
        if (catRes.error) return { error: true, status: 404, message: `Could not find a category named '${newArgs.categoryName}'.` };
        newArgs.categoryId = catRes.id;
        delete newArgs.categoryName;
      }
      return internalFetch("/menu-items", "POST", token, newArgs);
    }

    case "GET_SUPPLIER": return internalFetch("/suppliers", "GET", token);
    case "CREATE_SUPPLIER": return internalFetch("/suppliers", "POST", token, args);
    case "UPDATE_SUPPLIER": {
      const idRes: any = await resolveId("/suppliers", "name", args.name, token);
      if (idRes.error) return idRes;
      const { name, newName, ...rest } = args;
      return internalFetch(`/suppliers/${idRes.id}`, "PATCH", token, { ...rest, name: newName || name });
    }
    case "DELETE_SUPPLIER": {
      const idRes: any = await resolveId("/suppliers", "name", args.name, token);
      if (idRes.error) return idRes;
      return internalFetch(`/suppliers/${idRes.id}`, "DELETE", token);
    }

    case "GET_INVENTORY": return internalFetch("/inventory", "GET", token);
    case "CREATE_INVENTORY": return internalFetch("/inventory", "POST", token, args);
    case "UPDATE_INVENTORY": {
      const idRes: any = await resolveId("/inventory", "name", args.name, token);
      if (idRes.error) return idRes;
      const { name, ...rest } = args;
      return internalFetch(`/inventory/${idRes.id}`, "PATCH", token, rest);
    }
    case "DELETE_INVENTORY": {
      const idRes: any = await resolveId("/inventory", "name", args.name, token);
      if (idRes.error) return idRes;
      return internalFetch(`/inventory/${idRes.id}`, "DELETE", token);
    }

    case "GET_ORDER": return internalFetch(`/orders${args.status ? `?status=${args.status}` : ""}`, "GET", token);
    case "CREATE_ORDER": {
      const newArgs = { ...args };
      if (args.tableName) {
        const tableRes: any = await resolveId("/tables", "name", args.tableName, token);
        if (tableRes.error) return tableRes;
        newArgs.tableId = tableRes.id;
        delete newArgs.tableName;
      }
      if (args.items && args.items.length > 0) {
        const resolvedItems = [];
        for (const item of args.items) {
          const itemRes: any = await resolveId("/menu-items", "name", item.menuItemName, token);
          if (itemRes.error) return itemRes;
          resolvedItems.push({ menuItemId: itemRes.id, quantity: item.quantity, notes: item.notes });
        }
        newArgs.items = resolvedItems;
      }
      return internalFetch("/orders", "POST", token, newArgs);
    }
    case "UPDATE_ORDER": {
      const idRes: any = await resolveId("/orders", "orderNumber", args.orderNumber, token);
      if (idRes.error) return idRes;
      return internalFetch(`/orders/${idRes.id}/status`, "PATCH", token, { status: args.status });
    }
    case "CANCEL_ORDER": {
      const idRes: any = await resolveId("/orders", "orderNumber", args.orderNumber, token);
      if (idRes.error) return idRes;
      return internalFetch(`/orders/${idRes.id}/status`, "PATCH", token, { status: "CANCELLED" });
    }
    case "DELETE_ORDER": {
      const idRes: any = await resolveId("/orders", "orderNumber", args.orderNumber, token);
      if (idRes.error) return idRes;
      return internalFetch(`/orders/${idRes.id}`, "DELETE", token);
    }
    
    default: {
      logger.info(`Tool ${name} not explicitly mapped. Attempting automatic REST mapping.`);
      const matches = name.match(/^(CREATE|UPDATE|DELETE|GET)_([A-Z_]+)$/);
      if (matches) {
        const action = matches[1];
        let entity = matches[2].toLowerCase().replace(/_/g, "-") + "s";
        if (entity === "categorys") entity = "categories";
        if (entity === "inventorys") entity = "inventory";
        if (entity === "menus" || entity === "menu-items") entity = "menu-items";
        
        let method = "GET";
        if (action === "CREATE") method = "POST";
        else if (action === "UPDATE") method = "PATCH";
        else if (action === "DELETE") method = "DELETE";

        if (action === "CREATE" || action === "GET") {
          return internalFetch(`/${entity}`, method, token, args);
        } else {
          const searchKey = args.name ? "name" : (args.email ? "email" : "id");
          const searchValue = args.name || args.email || args.id;
          if (searchValue) {
             const idRes: any = await resolveId(`/${entity}`, searchKey, searchValue, token);
             if (idRes.error) return idRes;
             return internalFetch(`/${entity}/${idRes.id}`, method, token, action === "UPDATE" ? args : undefined);
          }
          return { error: true, message: `Cannot resolve ID for ${name}. Missing identifier.` };
        }
      }
      return { error: true, message: `Tool ${name} is not registered or automatically mapped.` };
    }
  }
}
