import type { Metadata } from "next";
import type { ReactNode } from "react";
import { IBM_Plex_Mono, Space_Grotesk } from "next/font/google";
import { AppShell } from "../components/app-shell";
import { ThemeProvider } from "../components/theme-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ignara",
  description: "Self-hosted smart office platform",
};

const headingFont = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
});

const dataFont = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-ibm-plex-mono",
});

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${headingFont.variable} ${dataFont.variable}`}>
        <ThemeProvider>
          <AppShell>{children}</AppShell>
        </ThemeProvider>
      </body>
    </html>
  );
}
