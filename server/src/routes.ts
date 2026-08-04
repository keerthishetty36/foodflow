import { Router } from "express";
import { RoleEnum, OrderStatus, PaymentMethod, PaymentStatus, TableStatus } from "@prisma/client";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { logger, prisma } from "./lib.js";
import { env } from "./config.js";
import { requirePermission, authConfigurationError, hashPassword, authenticate, setRefreshCookie, setAccessCookie, signAccess, signRefresh, verifyAndMigratePassword } from "./auth.js";
import { asyncHandler, audit, pagination } from "./utils.js";
import { emit } from "./realtime.js";
import { writeReceipt } from "./receipt.js";
import type { AuthRequest } from "./types.js";
import { chatStream } from "./ai/agent.js";
import {
  getConversations,
  getConversationHistory,
  deleteConversation,
  clearAllConversations
} from "./controllers/aiChatController.js";

const router = Router(); 

router.post("/ai/chat", authenticate, chatStream);
router.get("/ai/conversations", authenticate, getConversations);
router.get("/ai/conversations/:id", authenticate, getConversationHistory);
router.delete("/ai/conversations/:id", authenticate, deleteConversation);
router.delete("/ai/conversations", authenticate, clearAllConversations);

const id = z.string().min(1); const orderInput = z.object({ tableId: id.optional().nullable(), customerId: id.optional().nullable(), notes: z.string().max(1000).optional(), isHeld: z.boolean().optional(), items: z.array(z.object({ menuItemId: id, quantity: z.number().int().min(1).max(99), notes: z.string().max(500).optional() })).min(1) });
router.post("/auth/login", asyncHandler(async (req, res) => {
  const configurationError = authConfigurationError();
  if (configurationError) return res.status(503).json({ message: configurationError });
  const body = z.object({ email: z.string().email(), password: z.string().min(8) }).parse(req.body);
  const email = body.email.trim().toLowerCase();
  logger.info("Login request received", { email });
  try {
    const user = await prisma.user.findUnique({ where: { email }, include: { customRole: true } });
    if (!user) { logger.warn("Login failed: user not found", { email }); return res.status(401).json({ message: "User not found" }); }
    if (!user.active) { logger.warn("Login failed: user disabled", { userId: user.id }); return res.status(403).json({ message: "This user account is disabled" }); }
    const passwordMatched = await verifyAndMigratePassword(user.id, body.password, user.passwordHash);
    if (!passwordMatched) { logger.warn("Login failed: invalid password", { userId: user.id }); return res.status(401).json({ message: "Invalid password" }); }
    logger.info("Login password matched", { userId: user.id });
    const accessToken = signAccess(user);
    const refreshToken = signRefresh(user);
    await prisma.user.update({ where: { id: user.id }, data: { refreshToken } });
    setRefreshCookie(res, refreshToken);
    setAccessCookie(res, accessToken);
    await prisma.auditLog.create({ data: { userId: user.id, action: "LOGIN", entity: "User", entityId: user.id } });
    logger.info("JWT generated and login successful", { userId: user.id, role: user.role });
    const permissions = user.customRole?.permissions || (user.role === RoleEnum.ADMIN ? ["*"] : ["pos.view", "pos.bill", "orders.view", "orders.update", "tables.view", "menu.read"]);
    return res.json({ data: { user: { id: user.id, name: user.name, email: user.email, role: user.role, permissions }, role: user.role } });
  } catch (error) {
    logger.error("Login failed due to server error", { email, reason: error instanceof Error ? error.message : "Unknown error" });
    return res.status(503).json({ message: "Database connection failed. Please try again shortly." });
  }
}));
router.post("/auth/refresh", asyncHandler(async (req, res) => {
  const configurationError = authConfigurationError();
  if (configurationError) return res.status(503).json({ message: configurationError });
  const token = req.cookies.refreshToken;
  if (!token) return res.status(401).json({ message: "Refresh token missing" });
  try {
    const payload = jwt.verify(token, env.JWT_REFRESH_SECRET) as { sub: string };
    const user = await prisma.user.findUnique({ where: { id: payload.sub }, include: { customRole: true } });
    if (!user || !user.active || user.refreshToken !== token) return res.status(401).json({ message: "Invalid refresh token" });
    const refreshToken = signRefresh(user);
    const accessToken = signAccess(user);
    await prisma.user.update({ where: { id: user.id }, data: { refreshToken } });
    setRefreshCookie(res, refreshToken);
    setAccessCookie(res, accessToken);
    const permissions = user.customRole?.permissions || (user.role === RoleEnum.ADMIN ? ["*"] : ["pos.view", "pos.bill", "orders.view", "orders.update", "tables.view", "menu.read"]);
    return res.json({ data: { user: { id: user.id, name: user.name, email: user.email, role: user.role, permissions }, role: user.role } });
  } catch (error) { logger.warn("Refresh token rejected", { reason: error instanceof Error ? error.message : "Unknown error" }); return res.status(401).json({ message: "Invalid or expired refresh token" }); }
}));
router.post("/auth/logout", authenticate, asyncHandler(async (req: AuthRequest, res) => { await prisma.user.update({ where: { id: req.user!.sub }, data: { refreshToken: null } }); res.clearCookie("refreshToken", { path: "/api/auth" }); res.clearCookie("accessToken", { path: "/" }); await audit(req, "LOGOUT", "User", req.user!.sub); res.status(204).end() }));
router.get("/auth/me", authenticate, asyncHandler(async (req: AuthRequest, res) => { const user = await prisma.user.findUnique({ where: { id: req.user!.sub }, select: { id: true, name: true, email: true, role: true, active: true } }); res.json({ data: user }) }));

router.get("/dashboard", authenticate, requirePermission("dashboard.view"), asyncHandler(async (_req, res) => { const start = new Date(); start.setHours(0, 0, 0, 0); const [payments, pending, lowStock, top] = await Promise.all([prisma.payment.findMany({ where: { status: PaymentStatus.PAID, paidAt: { gte: start } }, include: { order: { include: { items: true, table: true, customer: true } } }, orderBy: { paidAt: "desc" } }), prisma.order.count({ where: { status: { in: [OrderStatus.PENDING, OrderStatus.ACCEPTED, OrderStatus.PREPARING, OrderStatus.READY, OrderStatus.SERVED] } } }), prisma.inventory.findMany({ where: { quantity: { lte: 0 } } }), prisma.orderItem.groupBy({ by: ["name"], _sum: { quantity: true }, orderBy: { _sum: { quantity: "desc" } }, take: 5 })]); const paidOrders = [...new Map(payments.map(p => [p.orderId, p.order])).values()], sales = payments.reduce((sum, payment) => sum + payment.amount, 0), profit = paidOrders.reduce((sum, order) => sum + order.items.reduce((itemSum, item) => itemSum + (item.unitPrice - item.costPrice) * item.quantity, 0), 0); res.json({ data: { todaySales: sales, revenue: sales, todayProfit: profit, orders: paidOrders.length, totalPaidOrders: paidOrders.length, runningOrders: pending, completedOrders: paidOrders.length, lowStock, recentOrders: payments.slice(0, 8).map(payment => ({ ...payment.order, grandTotal: payment.amount, paymentMethod: payment.method, paidAt: payment.paidAt })), recentPayments: payments.slice(0, 8), topSelling: top } }) }));

function crud(path: string, model: any, create: any, update: any, searchFields: string[] = [], readPerm: string, writePerm: string, deletePerm: string) { router.get(path, authenticate, requirePermission(readPerm), asyncHandler(async (req, res) => { const { page, limit } = pagination(req.query); const search = String(req.query.search || "").trim(); const where = search && searchFields.length ? { OR: searchFields.map(f => ({ [f]: { contains: search } })) } : {}; const [data, total] = await Promise.all([model.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { createdAt: "desc" } }), model.count({ where })]); res.json({ data, meta: { page, limit, total } }) })); router.post(path, authenticate, requirePermission(writePerm), asyncHandler(async (req: AuthRequest, res) => { const entity = await model.create({ data: create.parse(req.body) }); await audit(req, "CREATE", path, entity.id); res.status(201).json({ data: entity }) })); router.patch(`${path}/:id`, authenticate, requirePermission(writePerm), asyncHandler(async (req: AuthRequest, res) => { const entity = await model.update({ where: { id: String(req.params.id) }, data: update.partial().parse(req.body) }); await audit(req, "UPDATE", path, entity.id); res.json({ data: entity }) })); router.delete(`${path}/:id`, authenticate, requirePermission(deletePerm), asyncHandler(async (req: AuthRequest, res) => { const entityId = String(req.params.id); await model.delete({ where: { id: entityId } }); await audit(req, "DELETE", path, entityId); res.status(204).end() })); }
router.delete("/categories/:id", authenticate, requirePermission("menu.delete"), asyncHandler(async (req, res, next) => {
  const count = await prisma.menuItem.count({ where: { categoryId: String(req.params.id) } });
  if (count > 0) return res.status(400).json({ message: "This category contains menu items. Move or delete them first." });
  next();
}));
crud("/categories", prisma.category, z.object({ name: z.string().min(2), description: z.string().optional(), image: z.string().url().optional(), active: z.boolean().optional() }), z.object({ name: z.string().min(2), description: z.string().optional(), image: z.string().url().optional(), active: z.boolean().optional() }), ["name"], "menu.read", "menu.write", "menu.delete");
crud("/tables", prisma.diningTable, z.object({ name: z.string().min(1), capacity: z.number().int().min(1), status: z.nativeEnum(TableStatus).optional() }), z.object({ name: z.string().min(1), capacity: z.number().int().min(1), status: z.nativeEnum(TableStatus).optional() }), ["name"], "tables.view", "tables.view", "tables.view");
crud("/customers", prisma.customer, z.object({ name: z.string().min(2), phone: z.string().min(6), email: z.string().email().optional(), address: z.string().optional(), birthday: z.coerce.date().optional(), anniversary: z.coerce.date().optional() }), z.object({ name: z.string().min(2), phone: z.string().min(6), email: z.string().email().optional(), address: z.string().optional(), birthday: z.coerce.date().optional(), anniversary: z.coerce.date().optional() }), ["name", "phone", "email"], "pos.view", "pos.view", "pos.view");
crud("/suppliers", prisma.supplier, z.object({ name: z.string().min(2), phone: z.string().optional(), email: z.string().email().optional(), address: z.string().optional() }), z.object({ name: z.string().min(2), phone: z.string().optional(), email: z.string().email().optional(), address: z.string().optional() }), ["name", "phone"], "suppliers.view", "suppliers.write", "suppliers.write");
crud("/expenses", prisma.expense, z.object({ category: z.string().min(2), amount: z.number().positive(), date: z.coerce.date().optional(), notes: z.string().optional() }), z.object({ category: z.string().min(2), amount: z.number().positive(), date: z.coerce.date().optional(), notes: z.string().optional() }), ["category"], "reports.view", "reports.view", "reports.view");
crud("/inventory", prisma.inventory, z.object({ name: z.string().min(2), sku: z.string().optional(), unit: z.string().min(1), quantity: z.number().min(0), reorderLevel: z.number().min(0), expiryDate: z.coerce.date().optional() }), z.object({ name: z.string().min(2), sku: z.string().optional(), unit: z.string().min(1), quantity: z.number().min(0), reorderLevel: z.number().min(0), expiryDate: z.coerce.date().optional() }), ["name", "sku"], "inventory.read", "inventory.write", "inventory.delete");

router.get("/menu-items", authenticate, requirePermission("menu.read"), asyncHandler(async (req, res) => { const where: any = {}; if (req.query.categoryId) where.categoryId = String(req.query.categoryId); if (req.query.available !== undefined) where.available = req.query.available === "true"; if (req.query.search) where.OR = ["name", "barcode", "sku", "customCategory"].map(f => ({ [f]: { contains: String(req.query.search) } })); const data = await prisma.menuItem.findMany({ where, orderBy: { name: "asc" } }); res.json({ data }) }));
const normalizeVegType = (value: unknown) => { if (typeof value !== "string") return value; const normalized = value.trim().toLowerCase().replace(/[\s_-]/g, ""); return normalized === "veg" ? "VEG" : normalized === "nonveg" ? "NON_VEG" : normalized === "egg" ? "EGG" : value };
const normalizeMenuInput = (body: unknown) => { const input = body && typeof body === "object" ? body as Record<string, unknown> : {}; const normalized = Object.fromEntries(Object.entries(input).map(([key, value]) => [key, typeof value === "string" ? value.trim() : value])); for (const field of ["barcode", "sku"]) { if (normalized[field] === "") normalized[field] = null } if (normalized.image === "") normalized.image = undefined; return { ...normalized, price: normalized.price === undefined ? undefined : Number(normalized.price), costPrice: normalized.costPrice === undefined ? undefined : Number(normalized.costPrice), vegType: normalizeVegType(normalized.vegType) }; };
const menuSchema = z.object({ name: z.string().trim().min(2), description: z.string().optional(), image: z.string().nullable().optional(), categoryId: z.string().trim().min(1), customCategory: z.string().nullable().optional(), price: z.number().finite().positive(), costPrice: z.number().finite().min(0), tax: z.coerce.number().min(0).max(100).optional(), discount: z.coerce.number().min(0).max(100).optional(), preparationTime: z.coerce.number().int().min(0).optional(), available: z.boolean().optional(), vegType: z.enum(["VEG", "NON_VEG", "EGG"]), barcode: z.string().min(1).nullable().optional(), sku: z.string().min(1).nullable().optional(), calories: z.coerce.number().int().positive().optional() });
function sanitizeUniqueFields(data: any) {
  const cleaned = { ...data };
  const invalidValues = ["", " ", "null", "undefined", null, undefined];

  if (
    invalidValues.includes(cleaned.barcode) ||
    String(cleaned.barcode || "").trim() === ""
  ) {
    delete cleaned.barcode;
  }

  if (
    invalidValues.includes(cleaned.sku) ||
    String(cleaned.sku || "").trim() === ""
  ) {
    delete cleaned.sku;
  }

  return cleaned;
}
function menuUniqueErrorMessage(error: any) {
  console.error("P2002 ERROR:", error.meta);
  const target = String(error.meta?.target || "");
  if (target.includes("barcode")) return "Barcode already exists.";
  if (target.includes("sku")) return "SKU already exists.";
  return "Duplicate unique value.";
}
function menuValidationFailure(res: any, parsed: z.SafeParseError<unknown>) { const errors = parsed.error.issues.map(issue => ({ field: issue.path.join(".") || "request", message: issue.message, code: issue.code })); logger.warn("Menu item validation failed", { errors }); return res.status(422).json({ message: "Menu item validation failed", errors }); }
router.post("/menu-items", authenticate, requirePermission("menu.write"), asyncHandler(async (req: AuthRequest, res) => {
  const parsed = menuSchema.safeParse(normalizeMenuInput(req.body));
  if (!parsed.success) return menuValidationFailure(res, parsed);
  try {
    const finalData = sanitizeUniqueFields(parsed.data);
    console.log("REQUEST BODY:", req.body);
    console.log("PARSED DATA:", parsed.data);
    console.log("FINAL DATA:", finalData);
    if (finalData.barcode) {
      const existingBarcode = await prisma.menuItem.findFirst({ where: { barcode: finalData.barcode } });
      if (existingBarcode) return res.status(409).json({ message: "Barcode already exists." });
    }
    if (finalData.sku) {
      const existingSku = await prisma.menuItem.findFirst({ where: { sku: finalData.sku } });
      if (existingSku) return res.status(409).json({ message: "SKU already exists." });
    }
    const data = await prisma.menuItem.create({ data: { ...finalData } });
    await audit(req, "CREATE", "MenuItem", data.id);
    res.status(201).json({ data });
  } catch (error: any) {

    if (error?.code === "P2002") {

      return res.status(409).json({ message: menuUniqueErrorMessage(error) });
    }

    logger.error("Menu item create failed", {
      name: parsed.data.name,
      reason: error instanceof Error ? error.message : "Unknown error"
    });

    throw error;
  }




}));
router.patch("/menu-items/:id", authenticate, requirePermission("menu.write"), asyncHandler(async (req: AuthRequest, res) => {
  const parsed = menuSchema.partial().safeParse(normalizeMenuInput(req.body));
  if (!parsed.success) return menuValidationFailure(res, parsed);
  try {
    console.log("REQUEST BODY:", req.body);
    console.log("PARSED DATA:", parsed.data);
    const finalData = sanitizeUniqueFields(parsed.data);
    console.log("FINAL DATA:", finalData);
    const data = await prisma.menuItem.update({ where: { id: String(req.params.id) }, data: finalData });
    res.json({ data });
  } catch (error: any) {
    if (error?.code === "P2002") return res.status(409).json({ message: menuUniqueErrorMessage(error) });
    throw error;
  }
}));
router.delete("/menu-items/:id", authenticate, requirePermission("menu.delete"), asyncHandler(async (req: AuthRequest, res) => {
  await prisma.menuItem.delete({ where: { id: String(req.params.id) } });
  res.status(204).end();
}));



crud("/roles", prisma.role, z.object({ name: z.string().min(2), description: z.string().optional(), permissions: z.array(z.string()) }), z.object({ name: z.string().min(2).optional(), description: z.string().optional(), permissions: z.array(z.string()).optional() }), ["name"], "roles.read", "roles.edit", "roles.delete");

router.get("/orders", authenticate, requirePermission("orders.view"), asyncHandler(async (req, res) => { const where: any = {}; if (req.query.status) where.status = req.query.status; if (req.query.tableId) where.tableId = String(req.query.tableId); const data = await prisma.order.findMany({ where, include: { items: { include: { menuItem: true } }, table: true, customer: true, payments: true, cashier: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: 100 }); res.json({ data }) }));
router.post("/orders", authenticate, requirePermission("pos.bill"), asyncHandler(async (req: AuthRequest, res) => { const body = orderInput.parse(req.body); const menu = await prisma.menuItem.findMany({ where: { id: { in: body.items.map(i => i.menuItemId) }, available: true } }); if (menu.length !== body.items.length) return res.status(400).json({ message: "One or more items are unavailable" }); const rows = body.items.map(i => { const m = menu.find(x => x.id === i.menuItemId)!; const gross = m.price * i.quantity, disc = gross * m.discount / 100, tax = (gross - disc) * m.tax / 100; return { ...i, m, gross, disc, tax } }); const subtotal = rows.reduce((s, r) => s + r.gross, 0), discountTotal = rows.reduce((s, r) => s + r.disc, 0), taxTotal = rows.reduce((s, r) => s + r.tax, 0); const order = await prisma.$transaction(async tx => { if (body.tableId && !body.isHeld) { const table = await tx.diningTable.findUnique({ where: { id: body.tableId } }); if (!table || table.status !== TableStatus.AVAILABLE) throw Object.assign(new Error("Selected table is no longer available"), { status: 409 }); } const count = await tx.order.count(); const created = await tx.order.create({ data: { orderNumber: `FF-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${String(count + 1).padStart(4, "0")}`, tableId: body.tableId ?? undefined, customerId: body.customerId ?? undefined, cashierId: req.user!.sub, status: OrderStatus.PENDING, isHeld: body.isHeld ?? false, notes: body.notes, subtotal, discountTotal, taxTotal, grandTotal: subtotal - discountTotal + taxTotal, items: { create: rows.map(r => ({ menuItemId: r.m.id, name: r.m.name, quantity: r.quantity, unitPrice: r.m.price, costPrice: r.m.costPrice, tax: r.m.tax, discount: r.m.discount, notes: r.notes })) } }, include: { items: true, table: true, customer: true, cashier: { select: { name: true } } } }); if (body.tableId && !body.isHeld) await tx.diningTable.update({ where: { id: body.tableId }, data: { status: TableStatus.OCCUPIED } }); for (const row of rows) { const recipes = await tx.recipe.findMany({ where: { menuItemId: row.m.id }, include: { ingredient: true } }); for (const recipe of recipes) await tx.inventory.update({ where: { id: recipe.ingredient.inventoryId }, data: { quantity: { decrement: recipe.quantity * row.quantity } } }); } return created }); await audit(req, "CREATE", "Order", order.id); emit("order:created", order); emit("dashboard:updated", {}); res.status(201).json({ data: order }) }));
router.patch("/orders/:id/status", authenticate, requirePermission("orders.update"), asyncHandler(async (req: AuthRequest, res) => { const status = z.nativeEnum(OrderStatus).parse(req.body.status); const order = await prisma.order.update({ where: { id: String(req.params.id) }, data: { status, isHeld: false }, include: { items: true, table: true } }); if ((status === OrderStatus.COMPLETED || status === OrderStatus.CANCELLED) && order.tableId) await prisma.diningTable.update({ where: { id: order.tableId }, data: { status: "AVAILABLE" } }); await audit(req, "UPDATE_STATUS", "Order", order.id, { status }); emit("order:updated", order); emit("dashboard:updated", {}); res.json({ data: order }) }));
router.post("/orders/:id/payments", authenticate, requirePermission("pos.bill"), asyncHandler(async (req: AuthRequest, res) => { const body = z.object({ method: z.nativeEnum(PaymentMethod), amount: z.number().positive(), reference: z.string().optional() }).parse(req.body); const result = await prisma.$transaction(async tx => { const order = await tx.order.findUniqueOrThrow({ where: { id: String(req.params.id) } }); const paid = await tx.payment.aggregate({ where: { orderId: order.id, status: PaymentStatus.PAID }, _sum: { amount: true } }); if ((paid._sum.amount ?? 0) + body.amount > order.grandTotal + 0.01) throw Object.assign(new Error("Payment exceeds order total"), { status: 400 }); const payment = await tx.payment.create({ data: { orderId: order.id, cashierId: req.user!.sub, ...body, status: PaymentStatus.PAID, paidAt: new Date() } }); const isPaid = (paid._sum.amount ?? 0) + body.amount >= order.grandTotal - 0.01; if (isPaid) { await tx.order.update({ where: { id: order.id }, data: { status: OrderStatus.COMPLETED } }); if (order.tableId) await tx.diningTable.update({ where: { id: order.tableId }, data: { status: TableStatus.AVAILABLE } }); } return { payment, isPaid }; }); await audit(req, "PAYMENT", "Payment", result.payment.id, { orderId: String(req.params.id) }); emit("payment:completed", { orderId: String(req.params.id), ...result }); emit("dashboard:updated", {}); res.status(201).json({ data: result }) }));
router.get("/orders/:id/receipt", authenticate, requirePermission("pos.bill"), asyncHandler(async (req, res) => { const order = await prisma.order.findUniqueOrThrow({ where: { id: String(req.params.id) }, include: { items: true, table: true, customer: true, payments: true, cashier: { select: { name: true } } } }); writeReceipt(res, order) }));

router.get("/reports/sales", authenticate, requirePermission("reports.view"), asyncHandler(async (req, res) => { const from = req.query.from ? new Date(String(req.query.from)) : new Date(Date.now() - 30 * 864e5); const payments = await prisma.payment.findMany({ where: { status: PaymentStatus.PAID, paidAt: { gte: from } }, include: { order: { include: { items: true } } } }), orders = [...new Map(payments.map(payment => [payment.orderId, payment.order])).values()]; res.json({ data: { sales: payments.reduce((sum, payment) => sum + payment.amount, 0), orders: orders.length, tax: orders.reduce((sum, order) => sum + order.taxTotal, 0), profit: orders.reduce((sum, order) => sum + order.items.reduce((itemSum, item) => itemSum + (item.unitPrice - item.costPrice) * item.quantity, 0), 0), rows: orders } }) }));
router.get("/notifications", authenticate, requirePermission("notifications.view"), asyncHandler(async (req, res) => res.json({ data: await prisma.notification.findMany({ where: { OR: [{ userId: req.user!.sub }, { userId: null }] }, orderBy: { createdAt: "desc" }, take: 30 }) }))); router.patch("/notifications/:id/read", authenticate, requirePermission("notifications.view"), asyncHandler(async (req, res) => res.json({ data: await prisma.notification.update({ where: { id: String(req.params.id) }, data: { read: true } }) })));
router.get("/settings", authenticate, requirePermission("settings.view"), asyncHandler(async (_req, res) => res.json({ data: await prisma.setting.findFirst() }))); router.patch("/settings", authenticate, requirePermission("settings.edit"), asyncHandler(async (req, res) => { const existing = await prisma.setting.findFirst(); const schema = z.object({ restaurantName: z.string().min(2), logo: z.string().url().optional(), gst: z.string().optional(), phone: z.string().optional(), email: z.string().email().optional(), address: z.string().optional(), timezone: z.string().optional(), currency: z.string().optional(), receiptFooter: z.string().optional(), taxRate: z.number().min(0).max(100).optional() }); res.json({ data: existing ? await prisma.setting.update({ where: { id: existing.id }, data: schema.partial().parse(req.body) }) : await prisma.setting.create({ data: schema.parse(req.body) }) }) }));
router.get("/users", authenticate, requirePermission("users.view"), asyncHandler(async (_req, res) => res.json({ data: await prisma.user.findMany({ select: { id: true, name: true, email: true, role: true, active: true, createdAt: true, customRole: true } }) }))); 
router.post("/users", authenticate, requirePermission("users.create"), asyncHandler(async (req: AuthRequest, res) => { 
const body = z.object({ name: z.string().min(2), email: z.string().email(), password: z.string().min(8), roleId: z.string().optional(), role: z.nativeEnum(RoleEnum).optional().default(RoleEnum.CASHIER) }).parse(req.body); 
const { password, ...rest } = body;
const user = await prisma.user.create({ data: { ...rest, passwordHash: await hashPassword(password) } }); 
await audit(req, "CREATE", "User", user.id); res.status(201).json({ data: { id: user.id, name: user.name, email: user.email, role: user.role } }) })); 
router.patch("/users/:id", authenticate, requirePermission("users.edit"), asyncHandler(async (req, res) => { const body = z.object({ name: z.string().min(2).optional(), active: z.boolean().optional(), password: z.string().min(8).optional(), roleId: z.string().nullable().optional(), role: z.nativeEnum(RoleEnum).optional() }).parse(req.body); const data: any = { ...body }; if (body.password) { data.passwordHash = await hashPassword(body.password); delete data.password } res.json({ data: await prisma.user.update({ where: { id: String(req.params.id) }, data, select: { id: true, name: true, email: true, role: true, active: true } }) }) }));
router.delete("/users/:id", authenticate, requirePermission("users.delete"), asyncHandler(async (req: AuthRequest, res) => {
  await prisma.user.delete({ where: { id: String(req.params.id) } });
  await audit(req, "DELETE", "User", String(req.params.id));
  res.status(204).end();
}));
export default router;
