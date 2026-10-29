import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'FICAP — Financial Institution Cybersecurity Assurance Platform',
  description:
    'Authorised, scope-bound cybersecurity assessment and supervisory risk intelligence for supervised financial institutions.',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
