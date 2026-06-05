-- Expand FlowPay provider registry.

ALTER TYPE "GatewayProvider" ADD VALUE IF NOT EXISTS 'FLUTTERWAVE';
ALTER TYPE "GatewayProvider" ADD VALUE IF NOT EXISTS 'MONETBIL';
