import { createCampayAdapter } from "../src/modules/gateways/adapters/campay.adapter.js";
import dotenv from "dotenv";

dotenv.config();

const adapter = createCampayAdapter();

async function run() {
  if (!adapter) {
    console.error("CamPay adapter not configured");
    return;
  }

  console.log("1. Testing CamPay charge WITH leading + sign (+237600000000)...");
  try {
    const res1 = await adapter.charge({
      transactionId: `test-plus-${Date.now()}`,
      amount: 10,
      currency: "XAF",
      customerPhone: "+237600000000",
      customerEmail: "test@flowpay.com",
      customerName: "Test Plus",
      externalReference: "test-plus",
      phase: "capture"
    });
    console.log("Result WITH +:", JSON.stringify(res1, null, 2));
  } catch (err) {
    console.error("Error WITH +:", err);
  }

  console.log("\n2. Testing CamPay charge WITHOUT leading + sign (237600000000)...");
  try {
    const res2 = await adapter.charge({
      transactionId: `test-noplus-${Date.now()}`,
      amount: 10,
      currency: "XAF",
      customerPhone: "237600000000",
      customerEmail: "test@flowpay.com",
      customerName: "Test No Plus",
      externalReference: "test-noplus",
      phase: "capture"
    });
    console.log("Result WITHOUT +:", JSON.stringify(res2, null, 2));
  } catch (err) {
    console.error("Error WITHOUT +:", err);
  }
}

run();
