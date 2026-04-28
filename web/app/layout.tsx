import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Golden Hour — AI Emergency Dispatcher",
  description:
    "AI-powered emergency response coordination for India. Triage, hospital matching, and parallel dispatch in seconds.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
