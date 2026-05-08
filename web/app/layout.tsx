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
  const isTestBuild = process.env.NODE_ENV !== "production" || process.env.CHAIN_ENVIRONMENT === "testnet";
  const bannerText = locale === "zh"
    ? "测试版：仅供部分内部用户测试使用"
    : "Test build: for internal users only";

  return (
    <html lang={locale}>
      <body className="min-h-screen antialiased">
        {isTestBuild && (
          <div
            role="note"
            className="border-b border-amber-200/80 bg-amber-50/95 px-4 py-2 text-center text-[11px] font-semibold leading-5 text-amber-950 backdrop-blur dark:border-amber-400/30 dark:bg-amber-300/10 dark:text-amber-50"
          >
            {bannerText}
          </div>
        )}
        <ToastProvider>
          <AuthBootstrap />
          {children}
        </ToastProvider>
      </body>
    </html>
  );
}
