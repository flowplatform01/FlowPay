import { Loader2 } from "lucide-react";

export function CheckoutLoading({ embed = false }: { embed?: boolean }) {
  return (
    <main
      className={`flex items-center justify-center bg-surface-50 ${
        embed ? "min-h-full h-full" : "min-h-screen"
      }`}
    >
      <div className="flex flex-col items-center gap-4 px-6 text-center">
        <Loader2 className="h-9 w-9 animate-spin text-brand-600" />
        <p className="text-sm font-medium text-surface-600">Loading secure checkout...</p>
        <p className="text-xs text-surface-400">This usually takes a few seconds</p>
      </div>
    </main>
  );
}
