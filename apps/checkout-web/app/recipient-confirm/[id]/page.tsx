"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, AlertCircle, XCircle, ShieldCheck } from "lucide-react";
import { useParams, useSearchParams } from "next/navigation";

type RecipientSession = {
  id: string;
  externalRecipientId: string;
  providerType: string;
  payoutTarget: string;
  app: { name: string; slug: string };
  organization: { name: string; slug: string };
};

export default function RecipientConfirmationPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const id = params.id as string;
  const token = searchParams.get("token");

  const [session, setSession] = useState<RecipientSession | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "verifying" | "success" | "rejected" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    if (!id || !token) {
      setStatus("error");
      setErrorMessage("Invalid confirmation link. Missing ID or token.");
      return;
    }

    fetch(`${process.env.NEXT_PUBLIC_FLOWPAY_API_URL || "http://127.0.0.1:3011"}/api/v1/checkout/recipient/${id}?token=${token}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.message || "Session not found or expired");
        }
        return res.json();
      })
      .then((data) => {
        setSession(data);
        setStatus("ready");
      })
      .catch((err) => {
        setStatus("error");
        setErrorMessage(err.message);
      });
  }, [id, token]);

  const handleAction = async (action: "approve" | "reject") => {
    setStatus("verifying");
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_FLOWPAY_API_URL || "http://127.0.0.1:3011"}/api/v1/checkout/recipient/${id}/${action}?token=${token}`,
        { method: "POST" }
      );

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || `Failed to ${action} profile`);
      }

      setStatus(action === "approve" ? "success" : "rejected");
    } catch (err) {
      setStatus("error");
      setErrorMessage(err instanceof Error ? err.message : "An unexpected error occurred");
    }
  };

  if (status === "loading") {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="w-full max-w-md p-8 bg-white rounded-2xl shadow-sm border border-slate-100 flex flex-col items-center">
          <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mb-4" />
          <p className="text-slate-500 font-medium">Loading session...</p>
        </div>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="w-full max-w-md p-8 bg-white rounded-2xl shadow-sm border border-slate-100 text-center">
          <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-6">
            <AlertCircle className="w-8 h-8 text-red-600" />
          </div>
          <h1 className="text-xl font-bold text-slate-900 mb-2">Link Expired or Invalid</h1>
          <p className="text-slate-600 mb-6">{errorMessage}</p>
          <p className="text-sm text-slate-500">
            Please ask the application to send you a new confirmation link.
          </p>
        </div>
      </div>
    );
  }

  if (status === "success") {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="w-full max-w-md p-8 bg-white rounded-2xl shadow-sm border border-slate-100 text-center">
          <div className="w-16 h-16 bg-green-50 rounded-full flex items-center justify-center mx-auto mb-6">
            <CheckCircle2 className="w-8 h-8 text-green-600" />
          </div>
          <h1 className="text-xl font-bold text-slate-900 mb-2">Account Confirmed</h1>
          <p className="text-slate-600 mb-6">
            Your payout destination has been successfully verified. You can now close this window.
          </p>
        </div>
      </div>
    );
  }

  if (status === "rejected") {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="w-full max-w-md p-8 bg-white rounded-2xl shadow-sm border border-slate-100 text-center">
          <div className="w-16 h-16 bg-orange-50 rounded-full flex items-center justify-center mx-auto mb-6">
            <XCircle className="w-8 h-8 text-orange-600" />
          </div>
          <h1 className="text-xl font-bold text-slate-900 mb-2">Account Rejected</h1>
          <p className="text-slate-600 mb-6">
            We have blocked this account from being used for your payouts.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col p-4 md:p-8">
      <div className="max-w-md w-full mx-auto flex-grow flex flex-col justify-center">
        {/* Header */}
        <div className="mb-8 flex items-center justify-center space-x-2">
          <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
            <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <span className="text-xl font-bold tracking-tight text-slate-900">FlowPay</span>
        </div>

        {/* Main Card */}
        <div className="bg-white rounded-2xl shadow-xl shadow-slate-200/50 border border-slate-100 overflow-hidden">
          <div className="p-6 md:p-8">
            <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-xl flex items-center justify-center mb-6">
              <ShieldCheck className="w-6 h-6" />
            </div>

            <h1 className="text-2xl font-bold text-slate-900 mb-2">Action Required</h1>
            <p className="text-slate-600 mb-8">
              <span className="font-semibold text-slate-900">{session?.app.name}</span> has requested to set up or modify your payout destination. Please review the details carefully.
            </p>

            <div className="bg-slate-50 rounded-xl p-4 mb-8 space-y-4">
              <div>
                <div className="text-sm font-medium text-slate-500 mb-1">Provider</div>
                <div className="font-semibold text-slate-900">{session?.providerType}</div>
              </div>
              <div>
                <div className="text-sm font-medium text-slate-500 mb-1">Account / Target</div>
                <div className="font-mono text-lg font-bold text-indigo-600 tracking-wide">
                  {session?.payoutTarget}
                </div>
              </div>
              <div className="pt-2 border-t border-slate-200">
                <div className="text-sm text-slate-500">
                  ID: {session?.externalRecipientId}
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <button
                onClick={() => handleAction("approve")}
                disabled={status === "verifying"}
                className="w-full flex items-center justify-center px-6 py-3.5 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-xl transition-colors focus:ring-4 focus:ring-indigo-100 disabled:opacity-50"
              >
                {status === "verifying" ? (
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  "Yes, this is my account"
                )}
              </button>
              
              <button
                onClick={() => handleAction("reject")}
                disabled={status === "verifying"}
                className="w-full flex items-center justify-center px-6 py-3.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 font-medium rounded-xl transition-colors focus:ring-4 focus:ring-slate-100 disabled:opacity-50"
              >
                No, block this setup
              </button>
            </div>
          </div>
          
          <div className="bg-slate-50 p-4 border-t border-slate-100 text-center">
            <p className="text-xs text-slate-500">
              FlowPay ensures your payouts are securely routed to the correct destination. 
              Only approve this if you recognize the application requesting it.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
