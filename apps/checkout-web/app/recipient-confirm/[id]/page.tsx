"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, AlertCircle, XCircle, ShieldCheck, Pencil, X } from "lucide-react";
import { useParams, useSearchParams } from "next/navigation";
import {
  approveRecipientConfirmation,
  fetchRecipientConfirmationSession,
  rejectRecipientConfirmation,
  type RecipientConfirmationSession
} from "../../../lib/recipient-confirm-api";

type PageStatus = "loading" | "ready" | "editing" | "verifying" | "success" | "rejected" | "error";

export default function RecipientConfirmationPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const id = params.id as string;
  const token = searchParams.get("token");

  const [session, setSession] = useState<RecipientConfirmationSession | null>(null);
  const [payoutTargetDraft, setPayoutTargetDraft] = useState("");
  const [status, setStatus] = useState<PageStatus>("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);

  useEffect(() => {
    if (!id || !token) {
      setStatus("error");
      setErrorMessage("Invalid confirmation link. Missing ID or token.");
      return;
    }

    fetchRecipientConfirmationSession(id, token)
      .then((data) => {
        setSession(data);
        setPayoutTargetDraft(data.payoutTarget);
        setStatus("ready");
      })
      .catch((err) => {
        setStatus("error");
        setErrorMessage(err instanceof Error ? err.message : "Unable to load session");
      });
  }, [id, token]);

  const canEditPayoutTarget = useMemo(
    () => session?.editableFields.includes("payoutTarget") ?? false,
    [session]
  );

  const handleConfirm = async () => {
    if (!token) return;

    setFieldError(null);
    setStatus("verifying");

    try {
      const corrections =
        canEditPayoutTarget && payoutTargetDraft.trim() !== session?.payoutTarget
          ? { payoutTarget: payoutTargetDraft.trim() }
          : {};

      await approveRecipientConfirmation(id, token, corrections);
      setStatus("success");
    } catch (err) {
      setStatus("ready");
      setErrorMessage(err instanceof Error ? err.message : "Confirmation failed");
      setFieldError(err instanceof Error ? err.message : "Confirmation failed");
    }
  };

  const handleReject = async () => {
    if (!token) return;

    setStatus("verifying");
    try {
      await rejectRecipientConfirmation(id, token);
      setStatus("rejected");
    } catch (err) {
      setStatus("ready");
      setErrorMessage(err instanceof Error ? err.message : "Unable to reject setup");
    }
  };

  const shell = (content: ReactNode) => (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">{content}</div>
    </div>
  );

  if (status === "loading") {
    return shell(
      <div className="p-8 bg-white rounded-2xl shadow-sm border border-slate-100 flex flex-col items-center">
        <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mb-4" />
        <p className="text-slate-500 font-medium">Loading secure review...</p>
      </div>
    );
  }

  if (status === "error") {
    return shell(
      <div className="p-8 bg-white rounded-2xl shadow-sm border border-slate-100 text-center">
        <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-6">
          <AlertCircle className="w-8 h-8 text-red-600" />
        </div>
        <h1 className="text-xl font-bold text-slate-900 mb-2">Link Expired or Invalid</h1>
        <p className="text-slate-600 mb-6">{errorMessage}</p>
        <p className="text-sm text-slate-500">Ask the application to send a new confirmation link.</p>
      </div>
    );
  }

  if (status === "success") {
    return shell(
      <div className="p-8 bg-white rounded-2xl shadow-sm border border-slate-100 text-center">
        <div className="w-16 h-16 bg-green-50 rounded-full flex items-center justify-center mx-auto mb-6">
          <CheckCircle2 className="w-8 h-8 text-green-600" />
        </div>
        <h1 className="text-xl font-bold text-slate-900 mb-2">Payout Destination Confirmed</h1>
        <p className="text-slate-600">
          FlowPay saved and activated this payout destination. You can close this window.
        </p>
      </div>
    );
  }

  if (status === "rejected") {
    return shell(
      <div className="p-8 bg-white rounded-2xl shadow-sm border border-slate-100 text-center">
        <div className="w-16 h-16 bg-orange-50 rounded-full flex items-center justify-center mx-auto mb-6">
          <XCircle className="w-8 h-8 text-orange-600" />
        </div>
        <h1 className="text-xl font-bold text-slate-900 mb-2">Setup Cancelled</h1>
        <p className="text-slate-600">This payout destination was not activated.</p>
      </div>
    );
  }

  const canActivate = session?.capacityEligibility?.canActivate ?? true;
  const eligibilityNotice = session?.capacityEligibility?.reasons?.[0];

  const isEditing = status === "editing";

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col p-4 md:p-8">
      <div className="max-w-md w-full mx-auto flex-grow flex flex-col justify-center">
        <div className="mb-8 flex items-center justify-center space-x-2">
          <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
            <ShieldCheck className="w-5 h-5 text-white" />
          </div>
          <span className="text-xl font-bold tracking-tight text-slate-900">FlowPay Secure Review</span>
        </div>

        <div className="bg-white rounded-2xl shadow-xl shadow-slate-200/50 border border-slate-100 overflow-hidden">
          <div className="p-6 md:p-8">
            <h1 className="text-2xl font-bold text-slate-900 mb-2">Review Payout Destination</h1>
            <p className="text-slate-600 mb-6">
              <span className="font-semibold text-slate-900">{session?.app.name}</span> submitted payout details.
              Review carefully, edit if needed, then confirm.
            </p>

            <div className="bg-slate-50 rounded-xl p-4 mb-6 space-y-4">
              {session?.displayName && (
                <div>
                  <div className="text-sm font-medium text-slate-500 mb-1">Recipient name</div>
                  <div className="font-semibold text-slate-900">{session.displayName}</div>
                </div>
              )}
              <div>
                <div className="text-sm font-medium text-slate-500 mb-1">Payout method</div>
                <div className="font-semibold text-slate-900">{session?.paymentRailLabel}</div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <div className="text-sm font-medium text-slate-500">Wallet / account</div>
                  {canEditPayoutTarget && !isEditing && (
                    <button
                      type="button"
                      onClick={() => setStatus("editing")}
                      className="text-xs font-semibold text-indigo-600 inline-flex items-center gap-1"
                    >
                      <Pencil className="w-3 h-3" /> Edit
                    </button>
                  )}
                </div>
                {isEditing ? (
                  <div className="space-y-2">
                    <input
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                      value={payoutTargetDraft}
                      onChange={(event) => {
                        setPayoutTargetDraft(event.target.value);
                        setFieldError(null);
                      }}
                      aria-label="Payout target"
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className="text-xs font-medium text-slate-600 inline-flex items-center gap-1"
                        onClick={() => {
                          setPayoutTargetDraft(session?.payoutTarget ?? "");
                          setStatus("ready");
                          setFieldError(null);
                        }}
                      >
                        <X className="w-3 h-3" /> Cancel edit
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="font-mono text-lg font-bold text-indigo-600 tracking-wide break-all">
                    {payoutTargetDraft}
                  </div>
                )}
                {fieldError && <p className="text-sm text-red-600">{fieldError}</p>}
              </div>
              <div className="pt-2 border-t border-slate-200 text-sm text-slate-500">
                Reference: {session?.externalRecipientId} · {session?.regionalCurrency}
              </div>
            </div>

            {session?.capacityEligibility && (
              <div
                className={`mb-6 rounded-xl border px-4 py-3 text-sm ${
                  canActivate
                    ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                    : "border-amber-200 bg-amber-50 text-amber-950"
                }`}
              >
                <div className="font-semibold">
                  {canActivate ? "Activation requirements met" : "Activation currently blocked"}
                </div>
                <p className="mt-1">
                  {canActivate
                    ? `Capacity tier ${session.capacityEligibility.activeTier?.name ?? "active"} · ${session.capacityEligibility.currentUsage}/${session.capacityEligibility.effectiveMaxCapacity ?? "∞"} recipients · ${session.capacityEligibility.effectiveBalance} credits available`
                    : eligibilityNotice}
                </p>
                {!canActivate && session.capacityEligibility.nextTier && (
                  <p className="mt-2 text-xs opacity-90">
                    Next tier: {session.capacityEligibility.nextTier.name} requires at least{" "}
                    {session.capacityEligibility.nextTier.minEffectiveCredit} credits.
                  </p>
                )}
              </div>
            )}

            <div className="space-y-3">
              <button
                onClick={() => void handleConfirm()}
                disabled={status === "verifying" || !canActivate}
                className="w-full flex items-center justify-center px-6 py-3.5 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-xl transition-colors focus:ring-4 focus:ring-indigo-100 disabled:opacity-50"
              >
                {status === "verifying" ? (
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  "Confirm and activate"
                )}
              </button>
              <button
                onClick={() => void handleReject()}
                disabled={status === "verifying"}
                className="w-full flex items-center justify-center px-6 py-3.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 font-medium rounded-xl transition-colors focus:ring-4 focus:ring-slate-100 disabled:opacity-50"
              >
                Cancel setup
              </button>
            </div>
          </div>

          <div className="bg-slate-50 p-4 border-t border-slate-100 text-center">
            <p className="text-xs text-slate-500">
              FlowPay only activates destinations you explicitly confirm here. Your application cannot finalize this step for you.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
