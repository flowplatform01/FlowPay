const apiBaseUrl = process.env.NEXT_PUBLIC_FLOWPAY_API_URL ?? "http://127.0.0.1:3011";

export type RecipientConfirmationSession = {
  id: string;
  workflow: "RECIPIENT_SETUP";
  externalRecipientId: string;
  displayName: string | null;
  payoutTarget: string;
  paymentRailLabel: string;
  regionalCurrency: string;
  editableFields: Array<"payoutTarget">;
  app: { name: string; slug: string };
  organization: { name: string; slug: string };
  capacityEligibility?: {
    eligible: boolean;
    effectiveBalance: number;
    minCreditRequired: number;
    currentUsage: number;
    effectiveMaxCapacity: number | null;
    remainingCapacity: number | null;
    activeTier: {
      tierKey: string;
      name: string;
      description: string | null;
      maxCapacity: number | null;
      minEffectiveCredit: number;
    } | null;
    nextTier: {
      tierKey: string;
      name: string;
      description: string | null;
      maxCapacity: number | null;
      minEffectiveCredit: number;
    } | null;
    canActivate: boolean;
    canCreate: boolean;
    reasons: string[];
  };
};

function recipientPath(profileId: string, token: string, suffix = "") {
  const params = new URLSearchParams({ token });
  return `${apiBaseUrl}/api/v1/checkout/recipient/${profileId}${suffix}?${params.toString()}`;
}

export async function fetchRecipientConfirmationSession(profileId: string, token: string) {
  const response = await fetch(recipientPath(profileId, token));

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { message?: string };
    throw new Error(body.message ?? "Unable to load confirmation session");
  }

  return (await response.json()) as RecipientConfirmationSession;
}

export async function approveRecipientConfirmation(
  profileId: string,
  token: string,
  input: { payoutTarget?: string } = {}
) {
  const response = await fetch(recipientPath(profileId, token, "/approve"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input)
  });

  const body = (await response.json().catch(() => ({}))) as { message?: string; status?: string };

  if (!response.ok) {
    throw new Error(body.message ?? "Failed to confirm recipient");
  }

  return body;
}

export async function rejectRecipientConfirmation(profileId: string, token: string) {
  const response = await fetch(recipientPath(profileId, token, "/reject"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({})
  });

  const body = (await response.json().catch(() => ({}))) as { message?: string };

  if (!response.ok) {
    throw new Error(body.message ?? "Failed to reject recipient setup");
  }

  return body;
}
