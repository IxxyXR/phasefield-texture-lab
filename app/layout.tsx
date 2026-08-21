import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Phasefield 4OP — Spatial FM Synthesizer",
  description: "A four-operator FM network mapped from time into a two-dimensional pixel field.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
