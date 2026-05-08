import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import "./globals.css";
import { ToastProvider } from "@/components/ui";
import { AuthBootstrap } from "@/components/auth/AuthBootstrap";

export const metadata: Metadata = {
  title: "AnixOps - Private Node Deployment",
  description: "A refined, zero-knowledge platform for self-hosted and rental proxy node deployment.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8f5ef" },
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
      <body className="min-h-screen antialiased">
        <ToastProvider>
          <AuthBootstrap />
          {children}
        </ToastProvider>
      </body>
    </html>
  );
}
