import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Rising Star World Table Tennis",
  description: "Parent booking and club management for Rising Star World Table Tennis"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
