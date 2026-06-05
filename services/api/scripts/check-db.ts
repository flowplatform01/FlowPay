import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";

dotenv.config();

const prisma = new PrismaClient();

async function main() {
  console.log("Fetching latest transactions...");
  const txs = await prisma.transaction.findMany({
    orderBy: { createdAt: "desc" },
    take: 5,
    include: {
      paymentAttempts: true,
      events: true
    }
  });

  for (const t of txs) {
    console.log(`\nTransaction: ${t.id}`);
    console.log(`  Status: ${t.status}`);
    console.log(`  Amount: ${t.amount}`);
    console.log(`  Provider: ${t.selectedProvider}`);
    console.log(`  Phone: ${t.customerPhone}`);
    console.log(`  Failure Reason: ${t.failureReason}`);
    console.log(`  Payment Attempts Count: ${t.paymentAttempts.length}`);
    for (const attempt of t.paymentAttempts) {
      console.log(`    Attempt Status: ${attempt.status}`);
      console.log(`    Attempt Gateway Ref: ${attempt.gatewayReference}`);
      console.log(`    Response Payload: ${JSON.stringify(attempt.responsePayload)}`);
    }
    console.log(`  Events:`);
    for (const event of t.events) {
      console.log(`    - ${event.eventType}: ${JSON.stringify(event.payload)}`);
    }
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
