import "../src/config.js";
import { prisma } from "../src/lib.js";

async function main() {
  await prisma.$connect();
  const result = await prisma.$runCommandRaw({
    update: "Payment",
    updates: [{
      q: { status: "PAID", $or: [{ paidAt: { $exists: false } }, { paidAt: null }] },
      u: [{ $set: { paidAt: "$createdAt" } }],
      multi: true,
    }],
  }) as { nModified?: number };
  console.log(`Backfilled paidAt for ${result.nModified ?? 0} payment record(s).`);
}

main().then(() => prisma.$disconnect()).catch(async error => {
  console.error("Payment backfill failed:", error);
  await prisma.$disconnect();
  process.exit(1);
});
