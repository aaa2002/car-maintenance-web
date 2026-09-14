# Vehix Web

Responsive Next.js web client for the Vehix car-maintenance app. It uses the same Supabase
project, tables, Row Level Security policies, RPC, and private Storage buckets as the Expo app.

## Features

- Email/password sign in, sign up, email confirmation, and password-reset emails
- Fleet dashboard with expiring documents and scheduled repairs/trips
- Vehicle, repair, trip, ITP, and RCA create/edit/delete flows
- Car-photo and document uploads to the existing private Supabase buckets
- Monthly spending report with vehicle/category filters
- English/Romanian, RON/EUR, and light/dark/system browser-local preferences
- Vehix design system with independent light/dark palettes and Bootstrap-based responsive layout
- Desktop navigation, tablet icon rail, and a mobile bottom bar
- Accessible dialogs, field-level validation, skeleton loading, and toast feedback
- Reduced-motion support and keyboard-visible focus states

Browser background notifications are intentionally not scheduled: unlike native Expo local
notifications, browser notifications are not reliable after a tab is closed. Scheduled work and
expiring documents remain visible in the Needs attention dashboard.

## Front-end structure

- `src/theme/tokens.css` owns semantic colors, radii, shadows, spacing, and motion timing.
- `src/components/ui.tsx` contains reusable interaction and feedback primitives.
- `src/components/auth-provider.tsx` and `settings-provider.tsx` keep app state focused.
- `src/i18n/strings.ts` is the single English/Romanian copy catalog.
- `src/lib/database.ts` remains the centralized typed Supabase data boundary.
- Route files compose the primitives around the Garage, vehicle, spend, and settings workflows.

## Local development

Requires Node.js 20.9 or newer.

```bash
npm install
cp .env.example .env.local
npm run dev
```

Set the same publishable Supabase values used by the native app:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_<your-publishable-key>
```

Never add a Supabase secret/service-role key. All browser operations use the signed-in user's
JWT and the existing RLS policies.

## Vercel

Import this directory as a Vercel project and add both `NEXT_PUBLIC_SUPABASE_*` variables to
the Production, Preview, and Development environments. The default framework preset and build
command (`npm run build`) are sufficient.

Add the deployed origin and `https://*.vercel.app/**` preview pattern to Supabase Authentication
URL Configuration if sign-up confirmation and password-reset links should return to those URLs.
# car-maintenance-web
