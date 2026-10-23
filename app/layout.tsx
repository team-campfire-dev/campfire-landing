import type { Metadata } from 'next';
import { Bungee, Pixelify_Sans } from 'next/font/google';
import '@/app/globals.css';
import '@/styles/landing.css';

export const metadata: Metadata = {
  title: 'Team Campfire',
  description: '여러 분야의 작은 열정들이 만나는 공간 — 인디 게임 & 웹 서비스 개발조직',
  icons: {
    icon: '/favicon.ico',
  },
};

// Title fonts for the DOOM and Minecraft hero themes; only downloaded once a theme uses them.
const doomFont = Bungee({ weight: '400', subsets: ['latin'], variable: '--font-doom', preload: false });
const pixelFont = Pixelify_Sans({ weight: '700', subsets: ['latin'], variable: '--font-pixel', preload: false });

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko" className={`${doomFont.variable} ${pixelFont.variable}`}>
      <body>{children}</body>
    </html>
  );
}
