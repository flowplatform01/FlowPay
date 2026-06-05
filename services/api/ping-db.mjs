import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
try {
  await prisma.$connect();
  const result = await prisma.$queryRaw`SELECT 1 as alive`;
  console.log('✅ FlowPay DB: CONNECTED and AWAKE', result);
  await prisma.$disconnect();
} catch (err) {
  console.error('❌ FlowPay DB ERROR:', err.message);
  process.exit(1);
}
