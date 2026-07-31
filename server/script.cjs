const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const indexes = await prisma.$runCommandRaw({ listIndexes: 'MenuItem' });
  console.log(JSON.stringify(indexes, null, 2));
  await prisma.$disconnect();
}
main();
