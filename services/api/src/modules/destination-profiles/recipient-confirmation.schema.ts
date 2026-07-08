import { z } from "zod";

export const approveRecipientConfirmationSchema = z.object({
  payoutTarget: z.string().min(6).max(80).optional()
});

export const rejectRecipientConfirmationSchema = z.object({
  reason: z.string().max(240).optional()
});
