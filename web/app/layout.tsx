import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import "./globals.css";
import { ToastProvider } from "@/components/ui";

export const metadata: Metadata = {
  title: "AnixOps - One-Click Node Deployment",
  description: "Zero-knowledge proxy node deployment platform. Enter API key, get your config.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8fafc" },
    { media: "(prefers-color-scheme: dark)", color: "#0f172a" },
  ],
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Read locale from cookie (set by client-side locale store)
  const cookieStore = await cookies();
  const locale = cookieStore.get("locale")?.value || "zh";

  return (
    <html lang={locale}>
      <body className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 antialiased">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
