import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "FlowPay Checkout",
  description: "Secure hosted payment experience."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=0" />
      </head>
      <body style={{ fontFamily: "'Inter', sans-serif", margin: 0, minHeight: "100%" }}>
        {children}
      </body>
    </html>
  );
}
