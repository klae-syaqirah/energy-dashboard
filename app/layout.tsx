import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Factory Energy Monitor",
  description: "Real-time factory energy consumption from the PQM-1000s network analyzer",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
