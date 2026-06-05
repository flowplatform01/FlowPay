import type { NextConfig } from "next";

const embedOrigins = [
  "http://localhost:3025",
  "http://127.0.0.1:3025",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:5001",
  "http://127.0.0.1:5001"
].join(" ");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: "/checkout/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: `frame-ancestors 'self' ${embedOrigins};`
          }
        ]
      }
    ];
  }
};

export default nextConfig;
