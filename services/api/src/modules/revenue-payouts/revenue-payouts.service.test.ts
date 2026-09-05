import assert from "node:assert/strict";
import { getRevenuePayoutBalance } from "./revenue-payouts.service.js";

function createBalanceReader(collected = 1000, reserved = 250) {
  const calls: {
    settlementAggregate?: any;
    revenuePayoutAggregate?: any;
  } = {};

  const reader = {
    settlement: {
      aggregate: async (args: any) => {
        calls.settlementAggregate = args;
        return { _sum: { settlementAmount: collected } };
      }
    },
    revenuePayout: {
      aggregate: async (args: any) => {
        calls.revenuePayoutAggregate = args;
        return { _sum: { amount: reserved } };
      }
    }
  };

  return { reader, calls };
}

async function run() {
  const { reader, calls } = createBalanceReader();

  const balance = await getRevenuePayoutBalance(
    {
      organizationId: "org-1",
      appId: "app-a",
      currency: "xaf"
    },
    reader as any
  );

  assert.equal(balance.appId, "app-a");
  assert.equal(balance.currency, "XAF");
  assert.equal(balance.available, 750);
  assert.equal(calls.settlementAggregate.where.transaction.appId, "app-a");
  assert.deepEqual(calls.revenuePayoutAggregate.where.OR, [
    { appId: "app-a" },
    {
      metadata: {
        path: ["appId"],
        equals: "app-a"
      }
    }
  ]);

  const orgScoped = createBalanceReader(5000, 1000);

  const orgBalance = await getRevenuePayoutBalance(
    {
      organizationId: "org-1",
      currency: "XAF"
    },
    orgScoped.reader as any
  );

  assert.equal(orgBalance.appId, undefined);
  assert.equal(orgBalance.available, 4000);
  assert.equal(orgScoped.calls.settlementAggregate.where.transaction.appId, undefined);
  assert.equal(orgScoped.calls.revenuePayoutAggregate.where.OR, undefined);
}

run()
  .then(() => {
    console.log("REVENUE_PAYOUT_BALANCE_ISOLATION_TEST_OK");
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
