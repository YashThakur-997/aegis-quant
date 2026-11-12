import type { Metadata } from "next";
import { Toaster } from "sonner";

import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3001"
  ),
  title: {
    default: "AEGIS-QUANT | Autonomous Trading Desk",
    template: "%s | AEGIS-QUANT",
  },
  description:
    "Control room for the AEGIS-QUANT autonomous quantitative trading agent.",
  alternates: {
    canonical: "/",
  },
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml" }],
  },
  openGraph: {
    title: "AEGIS-QUANT | Autonomous Trading Desk",
    description:
      "Control room for the AEGIS-QUANT autonomous quantitative trading agent.",
    url: "/",
    siteName: "AEGIS-QUANT",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "AEGIS-QUANT | Autonomous Trading Desk",
    description:
      "Control room for the AEGIS-QUANT autonomous quantitative trading agent.",
  },
  robots: "noindex, nofollow",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body>
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-blue-400 focus:px-4 focus:py-2 focus:text-zinc-950 focus:text-sm focus:font-medium"
        >
          Skip to content
        </a>
        {children}
        <Toaster
          theme="dark"
          position="top-right"
          richColors
          closeButton
          toastOptions={{
            style: {
              fontFamily:
                "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
            },
          }}
        />
      </body>
    </html>
  );
}
