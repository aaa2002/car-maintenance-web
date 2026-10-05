import type { Metadata, Viewport } from 'next';
import { Geist } from 'next/font/google';
import 'bootstrap/dist/css/bootstrap.min.css';
import 'bootstrap-icons/font/bootstrap-icons.css';
import 'react-day-picker/style.css';
import '@/theme/tokens.css';
import './globals.css';
import { Providers } from '@/components/providers';

const sans = Geist({ subsets: ['latin', 'latin-ext'], variable: '--font-sans' });

export const metadata: Metadata = {
  title: { default: 'Vehix', template: '%s | Vehix' },
  description: 'Fleet maintenance, trip, cost and compliance tracking.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f5f5f7' },
    { media: '(prefers-color-scheme: dark)', color: '#0b0c0e' },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={sans.variable} data-scroll-behavior="smooth" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('vehix.theme')||'system';var d=t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.setAttribute('data-bs-theme',d?'dark':'light')}catch(e){}})()`,
          }}
        />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
