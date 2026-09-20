import type { Metadata } from "next";
import { DM_Mono, Outfit, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import { Nav } from "@/components/nav";

const jakarta = Plus_Jakarta_Sans({ variable: "--font-jakarta", subsets: ["latin"], weight: ["400", "500", "600"] });
const outfit = Outfit({ variable: "--font-outfit", subsets: ["latin"], weight: ["500", "600"] });
const dmMono = DM_Mono({ variable: "--font-dm-mono", subsets: ["latin"], weight: ["400", "500"] });

export const metadata: Metadata = {
  title: "Snitch",
  description: "Moments in a recorded interview worth a second look, with the evidence.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${jakarta.variable} ${outfit.variable} ${dmMono.variable} h-full antialiased`}>
      <body className="flex min-h-full font-sans">
        <Nav />
        <main className="min-w-0 flex-1 px-14 py-10">{children}</main>
      </body>
    </html>
  );
}
