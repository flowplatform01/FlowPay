"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Lock,
  Building,
  CheckCircle2,
  ShieldCheck,
  Loader2,
  ArrowRight,
  CreditCard,
  Smartphone,
  Landmark,
  AlertCircle,
  XCircle
} from "lucide-react";
import { getPaymentMethod, PAYMENT_METHODS, type PaymentMethodId } from "../../../lib/payment-methods";
import {
  createCheckoutStatusStream,
  confirmCheckoutPayment,
  fetchCheckoutSession,
  isTerminalStatus,
  isTransientCheckoutError,
  type CheckoutSession
} from "../../../lib/checkout-api";

const methodIcons = {
  MTN_MOMO: Smartphone,
  ORANGE_MONEY: Smartphone,
  CARD_PAYMENT: CreditCard,
  BANK_TRANSFER: Landmark
} as const;

type CheckoutClientProps = {
  transactionId: string;
  sessionToken: string;
  embed?: boolean;
};

const shellClass = (embed: boolean) =>
  embed
    ? "flex min-h-full h-full flex-col items-center bg-surface-50 p-3"
    : "flex min-h-screen flex-col items-center bg-surface-50 p-4 pb-12";

export function CheckoutClient({ transactionId, sessionToken, embed = false }: CheckoutClientProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sessionData, setSessionData] = useState<CheckoutSession | null>(null);
  const [selectedMethod, setSelectedMethod] = useState<PaymentMethodId>("MTN_MOMO");
  const [isProcessing, setIsProcessing] = useState(false);
  const [failureMessage, setFailureMessage] = useState<string | null>(null);
  const [processingMessage, setProcessingMessage] = useState<string | null>(null);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);

  useEffect(() => {
    if (embed && !loading && sessionData && typeof window !== "undefined") {
      window.parent.postMessage({ type: "flowpay:checkout-ready" }, "*");
    }
  }, [embed, loading, sessionData]);

  const postCheckoutStatus = useCallback(
    (payload: { status: string; message?: string | null }) => {
      if (!embed || typeof window === "undefined") return;

      const message = payload.message ?? null;
      window.parent.postMessage(
        {
          type: "flowpay:checkout-status",
          status: payload.status,
          transactionId,
          message
        },
        "*"
      );

      if (payload.status === "SUCCEEDED") {
        window.parent.postMessage(
          {
            type: "flowpay:checkout-completed",
            status: payload.status,
            transactionId,
            message: message ?? "Payment confirmed."
          },
          "*"
        );
      }

      if (["FAILED", "CANCELLED", "EXPIRED"].includes(payload.status)) {
        window.parent.postMessage(
          {
            type: "flowpay:checkout-failed",
            status: payload.status,
            transactionId,
            message: message ?? "Payment could not be completed."
          },
          "*"
        );
      }
    },
    [embed, transactionId]
  );

  const loadSession = useCallback(async () => {
    if (!transactionId || !sessionToken) {
      setError("Missing checkout session token. Open this page from your merchant app.");
      setLoading(false);
      return;
    }

    try {
      const data = await fetchCheckoutSession(transactionId, sessionToken);
      setSessionData(data);
      setSelectedMethod(data.paymentMethod || "MTN_MOMO");
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unable to load checkout session");
    } finally {
      setLoading(false);
    }
  }, [transactionId, sessionToken]);

  useEffect(() => {
    loadSession();
  }, [loadSession]);

  useEffect(() => {
    if (!transactionId || !sessionToken || typeof window === "undefined") return;

    let closed = false;
    const stream = createCheckoutStatusStream(transactionId, sessionToken);

    const handleStatus = (event: MessageEvent<string>) => {
      if (closed) return;

      try {
        const latest = JSON.parse(event.data) as CheckoutSession;
        setSessionData(latest);
        setSelectedMethod(latest.paymentMethod || "MTN_MOMO");
        setStatusNotice(null);

        if (latest.status === "FAILED") {
          setFailureMessage("Payment could not be completed.");
        }
      } catch {
        setStatusNotice("Live payment updates are temporarily unavailable. Status polling is still active.");
      }
    };

    const handleTransientError = () => {
      if (!closed) {
        setStatusNotice("Live payment updates are reconnecting. Status polling is still active.");
      }
    };

    stream.addEventListener("status", handleStatus);
    stream.addEventListener("transient-error", handleTransientError);
    stream.onerror = handleTransientError;

    return () => {
      closed = true;
      stream.removeEventListener("status", handleStatus);
      stream.removeEventListener("transient-error", handleTransientError);
      stream.close();
    };
  }, [sessionToken, transactionId]);

  useEffect(() => {
    if (!sessionData || !isTerminalStatus(sessionData.status)) return;

    postCheckoutStatus({
      status: sessionData.status,
      message:
        sessionData.status === "SUCCEEDED"
          ? "Payment confirmed."
          : sessionData.status === "UNDER_REVIEW"
            ? "Payment is being reviewed."
          : failureMessage ?? "Payment could not be completed."
    });
  }, [failureMessage, postCheckoutStatus, sessionData]);

  useEffect(() => {
    if (sessionData?.status !== "PROCESSING" || isProcessing) return;

    let cancelled = false;

    async function pollProcessingSession() {
      for (let attempt = 1; attempt <= 120 && !cancelled; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, pollingDelayForAttempt(attempt)));
        if (cancelled) return;

        try {
          const latest = await fetchCheckoutSession(transactionId, sessionToken);
          if (cancelled) return;

          setSessionData(latest);
          setStatusNotice(null);

          if (isTerminalStatus(latest.status)) {
            return;
          }
        } catch (err: unknown) {
          if (!isTransientCheckoutError(err)) {
            setStatusNotice("This payment is still being confirmed. Please keep this checkout open.");
          }
        }
      }

      if (!cancelled) {
        setStatusNotice(
          "This payment is still being confirmed. You can keep this sheet open or check the order from the merchant app."
        );
      }
    }

    pollProcessingSession();

    return () => {
      cancelled = true;
    };
  }, [isProcessing, sessionData?.status, sessionToken, transactionId]);

  const paymentMethods = sessionData?.paymentMethods?.length
    ? sessionData.paymentMethods
    : PAYMENT_METHODS.map((method) => ({
        id: method.id,
        label: method.label,
        type: method.type,
        fee: method.fee
      }));
  const activeMethod =
    paymentMethods.find((method) => method.id === selectedMethod) ?? getPaymentMethod(selectedMethod);
  const amount = sessionData?.amount ?? 0;
  const platformFee = sessionData?.platformFeeAmount ?? 0;
  const gatewayFee = sessionData?.gatewayFeeAmount ?? 0;
  const total = sessionData?.grossAmount ?? amount;
  const hasFees = platformFee > 0 || gatewayFee > 0;
  const status = sessionData?.status ?? "PENDING";
  const isSuccess = status === "SUCCEEDED";
  const isReview = status === "UNDER_REVIEW";
  const isFailed = ["FAILED", "CANCELLED", "EXPIRED"].includes(status) || Boolean(failureMessage);
  const isAwaitingConfirmation = status === "PROCESSING";
  const hasRecipientContext = Boolean(sessionData?.recipientName || sessionData?.recipientAccount);

  const canSubmit = useMemo(
    () => sessionData?.canConfirm && !isProcessing && !isAwaitingConfirmation && !isSuccess && !isFailed,
    [sessionData?.canConfirm, isProcessing, isAwaitingConfirmation, isSuccess, isFailed]
  );

  const handlePay = async () => {
    if (!sessionToken || !transactionId) return;

    setIsProcessing(true);
    setFailureMessage(null);
    setStatusNotice(null);
    setProcessingMessage("Waiting for mobile confirmation...");

    try {
      const result = await confirmCheckoutPayment(transactionId, sessionToken, selectedMethod);
      setSessionData(result);
      let finalSession: CheckoutSession = result;

      if (result.status === "FAILED") {
        setFailureMessage(result.message || "Payment could not be completed.");
      }

      if (result.status === "PROCESSING") {
        setStatusNotice("Waiting for payment confirmation...");
        postCheckoutStatus({
          status: "PROCESSING",
          message: "Payment verification is in progress."
        });
        return;
      }

      postCheckoutStatus({
        status: finalSession.status,
        message:
          finalSession.status === "SUCCEEDED"
            ? "Payment confirmed."
            : finalSession.status === "UNDER_REVIEW"
              ? "Payment is being reviewed."
            : finalSession.status === "FAILED"
              ? "Payment could not be completed."
              : "Payment is still waiting for confirmation."
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Payment confirmation failed";

      if (isTransientCheckoutError(err)) {
        setSessionData((current) =>
          current
            ? {
                ...current,
                status: "PROCESSING",
                canConfirm: false
              }
            : current
        );
        setStatusNotice(
          "This payment is still being confirmed. A temporary status refresh failed, but this is not a payment failure."
        );
        postCheckoutStatus({
          status: "PROCESSING",
          message: "Payment verification is still in progress."
        });
        return;
      }

      setFailureMessage(message);
      postCheckoutStatus({ status: "FAILED", message });
    } finally {
      setIsProcessing(false);
      setProcessingMessage(null);
    }
  };

  if (loading) {
    return (
      <main className={shellClass(embed)}>
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-brand-600" />
          <p className="text-sm font-medium text-surface-500">Securing payment session...</p>
        </div>
      </main>
    );
  }

  if (error || !sessionData) {
    return (
      <main className={shellClass(embed)}>
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md rounded-2xl border border-red-100 bg-white p-8 text-center shadow-lg"
        >
          <AlertCircle className="mx-auto h-12 w-12 text-red-500" />
          <h2 className="mt-4 text-xl font-bold text-surface-900">Session Error</h2>
          <p className="mt-2 text-sm text-surface-500">{error ?? "Payment session unavailable"}</p>
        </motion.div>
      </main>
    );
  }

  if (isReview) {
    return (
      <main className={shellClass(embed)}>
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="w-full max-w-md rounded-2xl border border-amber-100 bg-white p-8 text-center shadow-xl"
        >
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-amber-100 text-amber-600">
            <AlertCircle size={32} strokeWidth={2.5} />
          </div>
          <h1 className="mt-6 text-2xl font-bold text-surface-900">Payment Under Review</h1>
          <p className="mt-2 text-sm text-surface-500">
            We could not automatically confirm this payment. It has been moved to review instead of remaining in a
            waiting state.
          </p>
        </motion.div>
      </main>
    );
  }

  if (isFailed) {
    return (
      <main className={shellClass(embed)}>
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="w-full max-w-md rounded-2xl border border-red-100 bg-white p-8 text-center shadow-xl"
        >
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-red-100 text-red-600">
            <XCircle size={32} strokeWidth={2.5} />
          </div>
          <h1 className="mt-6 text-2xl font-bold text-surface-900">Payment Failed</h1>
          <p className="mt-2 text-sm text-surface-500">
            {failureMessage ?? "This payment could not be completed. Please try again from the merchant app."}
          </p>
        </motion.div>
      </main>
    );
  }

  if (isSuccess) {
    return (
      <main className={shellClass(embed)}>
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="w-full max-w-md rounded-2xl border border-surface-200 bg-white p-8 text-center shadow-xl"
        >
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
            <CheckCircle2 size={32} strokeWidth={2.5} />
          </div>
          <h1 className="mt-6 text-2xl font-bold text-surface-900">Payment Successful</h1>
          <p className="mt-2 text-sm text-surface-500">
            {total.toLocaleString()} {sessionData.currency} paid to {sessionData.organizationName} via{" "}
            {activeMethod.label}.
          </p>
          <div className="mt-8 rounded-xl bg-surface-50 p-4 text-xs font-medium text-surface-500">
            Your payment is confirmed. You can safely close this window.
          </div>
        </motion.div>
      </main>
    );
  }

  return (
    <main className={shellClass(embed)}>
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-lg flex-1">
        {!embed && (
          <div className="mb-6 mt-4 flex items-center justify-center gap-2 text-sm font-medium text-surface-500">
            <Lock size={14} className="text-emerald-500" />
            Secure FlowPay Session
          </div>
        )}

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="overflow-hidden rounded-2xl border border-surface-200 bg-white shadow-2xl"
        >
          <div className="border-b border-surface-100 bg-surface-50/50 p-5">
            <motion.div layout className="flex items-center gap-4">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-surface-200 bg-white text-surface-600 shadow-sm">
                {sessionData.isCreditPurchase ? <CreditCard size={20} /> : <Building size={20} />}
              </div>
              <div>
                <div className="text-[10px] font-bold uppercase tracking-widest text-surface-400">
                  {sessionData.isCreditPurchase ? "Credit Top-Up For" : "Paying"}
                </div>
                <div className="mt-0.5 text-lg font-bold text-surface-900">{sessionData.organizationName}</div>
              </div>
            </motion.div>
          </div>

          <div className="border-b border-surface-100 p-5 text-center">
            <div className="text-sm font-medium text-surface-500">Total Due</div>
              <motion.div
              key={`${total}-${selectedMethod}`}
              initial={{ scale: 0.98, opacity: 0.85 }}
              animate={{ scale: 1, opacity: 1 }}
              className="mt-1 flex items-baseline justify-center gap-1.5"
            >
              <span className="text-3xl font-black tracking-tight text-surface-900">{total.toLocaleString()}</span>
              <span className="text-base font-semibold text-surface-400">{sessionData.currency}</span>
            </motion.div>
            {hasFees ? (
              <div className="mt-4 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-surface-500">Amount</span>
                  <span className="font-medium text-surface-900">
                    {amount.toLocaleString()} {sessionData.currency}
                  </span>
                </div>
                {platformFee > 0 ? (
                  <div className="flex justify-between text-xs text-surface-400">
                    <span>Platform fee</span>
                    <span>
                      {platformFee.toLocaleString()} {sessionData.currency}
                    </span>
                  </div>
                ) : null}
                {gatewayFee > 0 ? (
                  <div className="flex justify-between text-xs text-surface-400">
                    <span>Processing fee</span>
                    <span>
                      {gatewayFee.toLocaleString()} {sessionData.currency}
                    </span>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="p-5">
            <div className="mb-4 rounded-xl border border-surface-100 bg-surface-50 p-3">
              <div className="grid gap-2 text-xs sm:grid-cols-2">
                <CheckoutContextItem label="Reference" value={sessionData.externalReference} />
                <CheckoutContextItem
                  label={sessionData.isCreditPurchase ? "Purpose" : hasRecipientContext ? "Recipient" : "Merchant"}
                  value={sessionData.isCreditPurchase ? "FlowPay Operational Credits" : sessionData.recipientName || sessionData.organizationName}
                />
                <CheckoutContextItem
                  label="Details"
                  value={sessionData.isCreditPurchase ? `Purchase ${amount.toLocaleString()} Credits` : sessionData.paymentDescription || "Payment authorization"}
                />
                <CheckoutContextItem
                  label={sessionData.isCreditPurchase ? "Conversion" : hasRecipientContext ? "Account" : "Payee"}
                  value={sessionData.isCreditPurchase ? "1 XAF = 1 Credit" : sessionData.recipientAccount || sessionData.organizationName}
                />
              </div>
            </div>

            <div className="mb-3 text-sm font-bold text-surface-900">Payment Method</div>
            <div className="space-y-2">
              {paymentMethods.map((method) => {
                const isActive = selectedMethod === method.id;
                const Icon = methodIcons[method.id as PaymentMethodId] ?? Smartphone;
                return (
                  <motion.div
                    key={method.id}
                    layout
                    whileTap={canSubmit ? { scale: 0.98 } : {}}
                    onClick={() => canSubmit && setSelectedMethod(method.id)}
                    className={`flex cursor-pointer items-center justify-between rounded-xl border-2 p-3 transition-all ${
                      isActive
                        ? "border-brand-600 bg-brand-50/50 ring-2 ring-brand-100"
                        : "border-surface-100 hover:border-surface-200"
                    } ${!canSubmit ? "pointer-events-none opacity-60" : ""}`}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`flex h-9 w-9 items-center justify-center rounded-lg ${
                          isActive ? "bg-brand-600 text-white" : "bg-surface-100 text-surface-500"
                        }`}
                      >
                        <Icon size={18} />
                      </div>
                      <div>
                        <div className="text-sm font-bold text-surface-900">{method.label}</div>
                        <div className="text-[10px] font-medium text-surface-500">{method.type}</div>
                      </div>
                    </div>
                    {method.fee > 0 ? (
                      <motion.div layout className={`text-sm font-bold ${isActive ? "text-brand-600" : "text-surface-900"}`}>
                        +{method.fee.toLocaleString()}
                      </motion.div>
                    ) : null}
                  </motion.div>
                );
              })}
            </div>
          </div>

          <div className="bg-surface-50 p-5">
            <motion.button
              whileHover={{ scale: canSubmit ? 1.01 : 1 }}
              whileTap={{ scale: canSubmit ? 0.99 : 1 }}
              onClick={handlePay}
              disabled={!canSubmit}
              className="flex w-full items-center justify-center rounded-xl bg-brand-600 px-4 py-3.5 text-sm font-bold text-white shadow-lg hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <AnimatePresence mode="wait">
                {isProcessing || isAwaitingConfirmation ? (
                  <motion.span
                    key="processing"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="flex items-center gap-2"
                  >
                    <Loader2 size={18} className="animate-spin" />
                    {processingMessage ?? "Awaiting confirmation..."}
                  </motion.span>
                ) : (
                  <motion.span
                    key="pay"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="flex items-center gap-2"
                  >
                    Authorize {total.toLocaleString()} {sessionData.currency}
                    <ArrowRight size={16} />
                  </motion.span>
                )}
              </AnimatePresence>
            </motion.button>
            <div className="mt-3 flex items-center justify-center gap-1.5 text-[10px] font-medium uppercase tracking-tighter text-surface-400">
              <ShieldCheck size={14} className="text-brand-500" />
              Secured by FlowPay
            </div>
            {isAwaitingConfirmation ? (
              <p className="mt-3 text-center text-xs font-medium text-surface-500">
                {statusNotice ?? "Keep this sheet open while the payment is confirmed."}
              </p>
            ) : null}
          </div>
        </motion.div>
      </motion.div>
    </main>
  );
}

function CheckoutContextItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-surface-400">{label}</div>
      <div className="mt-0.5 truncate font-medium text-surface-800">{value}</div>
    </div>
  );
}

function pollingDelayForAttempt(attempt: number) {
  if (attempt <= 2) return 750;
  if (attempt <= 5) return 1_500;
  if (attempt <= 12) return 2_000;
  return 3_000;
}
