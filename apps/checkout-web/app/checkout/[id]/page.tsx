import { Suspense } from "react";
import { CheckoutClient } from "./CheckoutClient";
import { CheckoutLoading } from "./CheckoutLoading";

type CheckoutPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ token?: string; embed?: string }>;
};

export default async function CheckoutPage({ params, searchParams }: CheckoutPageProps) {
  const { id } = await params;
  const query = await searchParams;
  const embed = query.embed === "1";

  return (
    <Suspense fallback={<CheckoutLoading embed={embed} />}>
      <CheckoutClient transactionId={id} sessionToken={query.token ?? ""} embed={embed} />
    </Suspense>
  );
}
