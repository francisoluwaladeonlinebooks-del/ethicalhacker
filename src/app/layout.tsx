import type { Metadata } from 'next';
// Self-hosted typefaces: no third-party font request, so `font-src 'self'` stays
// strict and no visitor address is disclosed to a font CDN. See design.md §4.
import '@fontsource-variable/inter';
import '@fontsource-variable/playfair-display';
import '@fontsource-variable/playfair-display/wght-italic.css';
import './globals.css';

export const metadata: Metadata = {
  title: 'FICAP — Financial Institution Cybersecurity Assurance Platform',
  description:
    'Authorised, scope-bound cybersecurity assessment and supervisory risk intelligence for supervised financial institutions.',
  robots: { index: false, follow: false },
  openGraph: {
    title: 'FICAP — Financial Institution Cybersecurity Assurance Platform',
    description:
      'Authorised, scope-bound cybersecurity assessment and supervisory risk intelligence for supervised financial institutions.',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
