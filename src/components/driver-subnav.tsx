'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSettings } from './providers';

const TABS = [
  { href: '/drivers', key: 'drivers', icon: 'bi-people' },
  { href: '/drivers/payments', key: 'payouts', icon: 'bi-cash-stack' },
  { href: '/drivers/invoices', key: 'invoices', icon: 'bi-file-earmark-text' },
  { href: '/drivers/rides', key: 'rideInvoices', icon: 'bi-receipt' },
  { href: '/drivers/import', key: 'import', icon: 'bi-upload' },
] as const;

/** Tabs across the driver money pages: people, payouts, invoices, the ride-invoice archive and imports. */
export function DriverSubnav() {
  const { t } = useSettings();
  const pathname = usePathname();
  const active = (href: string) => (href === '/drivers' ? pathname === '/drivers' : pathname.startsWith(href));
  return <nav className="subnav no-print" aria-label={t('drivers')}>
    {TABS.map((tab) => <Link key={tab.href} href={tab.href} aria-current={active(tab.href) ? 'page' : undefined} className={active(tab.href) ? 'active' : ''}><i className={`bi ${tab.icon}`} aria-hidden="true" />{t(tab.key)}</Link>)}
  </nav>;
}
