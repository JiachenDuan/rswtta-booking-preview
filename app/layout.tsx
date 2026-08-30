import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Rising Stars World Table Tennis Academy",
  description: "Parent booking and club management for Rising Stars World Table Tennis Academy"
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
