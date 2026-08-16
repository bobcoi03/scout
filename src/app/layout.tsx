import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Scout — Fresh signals from X",
  description: "A live feed of new products, open-source projects, demos, and founders discovered on X.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <link rel="preconnect" href="https://platform.twitter.com" />
        <link rel="preconnect" href="https://pbs.twimg.com" crossOrigin="anonymous" />
        <link rel="dns-prefetch" href="https://video.twimg.com" />
      </head>
      <body className="min-h-full bg-[#eeebe5] text-[#181818]">{children}</body>
    </html>
  );
}
