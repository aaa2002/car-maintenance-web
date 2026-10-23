import type { Metadata } from 'next';
import { PrivacyPolicy } from '@/components/privacy-policy';

export const metadata: Metadata = {
  title: 'Privacy policy',
  description: 'What personal data Vehix collects, why, where it is stored and your rights over it.',
};

export default function PrivacyPage() {
  return <PrivacyPolicy />;
}
