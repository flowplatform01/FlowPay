"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Lock, Building, ShieldCheck, ArrowRight } from "lucide-react";
import { PAYMENT_METHODS, type PaymentMethodId } from "../lib/payment-methods";

export default function CheckoutPreviewPage() {
  const [selectedMethod, setSelectedMethod] = useState<PaymentMethodId>("MTN_MOMO");
  const [previewNotice, setPreviewNotice] = useState<string | null>(null);

  const baseAmount = 100000;
  const activeMethod = PAYMENT_METHODS.find((method) => method.id === selectedMethod) ?? PAYMENT_METHODS[0];
  const total = baseAmount;

  return (
    <main className="checkout-container">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-lg">
        <motion.div className="mb-6 flex items-center justify-center gap-2 text-sm font-medium text-surface-500">
          <Lock size={14} className="text-emerald-500" />
          Secure FlowPay Session
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="card-premium">
          <div className="border-b border-surface-100 bg-surface-50/50 p-6">
            <motion.div layout className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-surface-200 bg-white text-surface-600 shadow-soft-sm">
                <Building size={20} />
              </div>
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-surface-400">Paying</div>
                <div className="mt-0.5 text-lg font-semibold text-surface-900">Campus Demo Schools</div>
              </div>
            </motion.div>
          </div>

          <div className="border-b border-amber-100 bg-amber-50 px-6 py-3 text-xs font-medium text-amber-800">
            Design preview only. Real payments open from your merchant app after initialization.
          </div>

          {previewNotice && (
            <div className="border-b border-amber-100 bg-amber-50/80 px-6 py-2 text-xs text-amber-900">
              {previewNotice}
            </div>
          )}

          <div className="border-b border-surface-100 p-6 text-center">
            <div className="text-sm font-medium text-surface-500">Total Due</div>
            <motion.div layout className="mt-1 text-4xl font-bold text-surface-900">
              {total.toLocaleString()} <span className="text-lg text-surface-400">XAF</span>
            </motion.div>
          </div>

          <div className="p-6">
            <div className="mb-4 text-sm font-medium text-surface-700">Select payment method</div>
            <div className="space-y-3">
              {PAYMENT_METHODS.map((method) => (
                <motion.div
                  key={method.id}
                  layout
                  className={`provider-card flex items-center justify-between ${selectedMethod === method.id ? "provider-card-active" : ""
                    }`}
                  onClick={() => setSelectedMethod(method.id)}
                  whileTap={{ scale: 0.985 }}
                >
                  <div>
                    <motion.div layout className="text-sm font-semibold text-surface-900">
                      {method.label}
                    </motion.div>
                    <div className="text-xs text-surface-500">{method.type}</div>
                  </div>
                  <div className="text-sm font-medium">+{method.fee.toLocaleString()} XAF</div>
                </motion.div>
              ))}
            </div>
          </div>

          <div className="bg-surface-50 p-6">
            <motion.button
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.99 }}
              onClick={() =>
                setPreviewNotice(
                  "Initialize a payment from your merchant app to receive a secure checkout link."
                )
              }
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 py-4 text-sm font-medium text-white hover:bg-brand-700"
            >
              Preview checkout
              <ArrowRight size={16} />
            </motion.button>
            <div className="mt-4 flex items-center justify-center gap-1.5 text-xs text-surface-400">
              <ShieldCheck size={14} />
              Payments are securely processed by FlowPay
            </div>
          </div>
        </motion.div>
      </motion.div>
    </main>
  );
}
