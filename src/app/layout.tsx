import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: { template: "%s | AI Dev Tools Compare", default: "AI Dev Tools Compare" },
  description: "Side-by-side comparisons, rankings and alternatives for AI developer tools.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen antialiased">
        {children}
      </body>
    </html>
  );
}
