import "../src/config.js";
import { PrismaClient, Role, TableStatus, VegType } from "@prisma/client";
import bcrypt from "bcrypt";

const prisma = new PrismaClient();
async function ensureUser(name: string, email: string, password: string, role: Role) {
  const passwordHash = await bcrypt.hash(password, 12);
  const existing = await prisma.user.findUnique({ where: { email } });
  if (!existing) return prisma.user.create({ data: { name, email, passwordHash, role, active: true } });
  const validHash = existing.passwordHash.startsWith("$2a$") || existing.passwordHash.startsWith("$2b$") || existing.passwordHash.startsWith("$2y$");
  return prisma.user.update({ where: { id: existing.id }, data: { name, role, active: true, ...(validHash ? {} : { passwordHash }) } });
}
async function main() {
  await prisma.$connect();
  await ensureUser("System Admin", "admin@foodflow.local", "Admin@123", Role.ADMIN);
  await ensureUser("Priya Cashier", "cashier@foodflow.local", "Cashier@123", Role.CASHIER);
  const south = await prisma.category.upsert({ where: { name: "South Indian" }, update: {}, create: { name: "South Indian", description: "Traditional favourites" } });
  const drinks = await prisma.category.upsert({ where: { name: "Beverages" }, update: {}, create: { name: "Beverages", description: "Fresh hot and cold drinks" } });
  for (const [name, price, costPrice, categoryId, vegType] of [["Masala Dosa", 120, 42, south.id, VegType.VEG], ["Idli Sambar", 80, 26, south.id, VegType.VEG], ["Filter Coffee", 45, 12, drinks.id, VegType.VEG]] as const) if (!await prisma.menuItem.findFirst({ where: { name, categoryId } })) await prisma.menuItem.create({ data: { name, price, costPrice, categoryId, vegType, tax: 5, preparationTime: 12 } });
  for (let i = 1; i <= 10; i += 1) await prisma.diningTable.upsert({ where: { name: `Table ${i}` }, update: {}, create: { name: `Table ${i}`, capacity: 4, status: TableStatus.AVAILABLE } });
  if (!await prisma.setting.count()) await prisma.setting.create({ data: { restaurantName: "FoodFlow Kitchen", gst: "29ABCDE1234F1Z5", phone: "+91 98765 43210", address: "Bengaluru, Karnataka", receiptFooter: "Thank you for dining with us!" } });
  console.log("Seed completed. Admin account: admin@foodflow.local");
}
main().then(() => prisma.$disconnect()).catch(async error => { console.error("Seed failed:", error); await prisma.$disconnect(); process.exit(1); });
