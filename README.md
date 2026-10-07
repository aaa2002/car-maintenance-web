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

## Billing (Stripe)

Plans live in `public.plans`: Free (3 vehicles), Standard (10, 49 RON/month), PRO (30, 99 RON/month) and
FLEET (60 included for 149 RON/month, then 2 RON per extra vehicle). Prices are monthly, in RON, VAT included.

- **Limits are enforced in the database.** A trigger on `cars` blocks inserts beyond the plan's limit, so the
  web and Expo apps behave the same.
- **Downgrades and cancellations take effect at the end of the paid period**, with no credit for the unused time
  (implemented with a Stripe subscription schedule). Upgrades apply immediately and are invoiced on the spot.
- **Vehicles above the limit become read-only** once a lower plan applies (after a downgrade, cancellation, or a
  subscription ending): they stay visible, but the vehicle, its repairs, trips and documents cannot be changed
  (deleting is allowed). The oldest vehicles stay active by default; users choose which ones in Settings
  (`set_active_vehicles`). The `cars.locked` flag is maintained by the database and cannot be set through the API.
- **Edge Functions** (`supabase/functions`) hold all Stripe calls: `billing-checkout` (new subscriptions),
  `billing-change-plan` (switch plan, cancel at period end, resume), `billing-portal` (card, invoices,
  cancellation), `stripe-webhook` (mirrors subscriptions into `public.subscriptions`) and `billing-sync`.
- **FLEET** is a single graduated Stripe price whose quantity is the vehicle count. When a FLEET customer adds or
  removes vehicles, a statement-level database trigger calls `billing-sync` once per user (via `pg_net`,
  authenticated with a token stored in Vault). Extra vehicles are invoiced immediately; removing vehicles mid-period
  is not refunded and lowers the next renewal.

### Setting up a Stripe sandbox

1. Put `STRIPE_SECRET_KEY=sk_test_...` in `.env.local`.
2. Run `node scripts/stripe-setup.mjs`. It creates (or finds) the products, prices, customer portal configuration
   and webhook, writes `STRIPE_WEBHOOK_SECRET` to `.env.local`, and prints the price IDs.
3. Store the price IDs in `public.plans.stripe_price_id` (they differ per Stripe account and mode, so they are data,
   not a migration).
4. Add `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` under Edge Functions > Secrets in the Supabase dashboard.
5. Optional: `APP_ORIGINS` (comma-separated) to allow Checkout redirects to a custom domain. `localhost` and
   `*.vercel.app` are always allowed.

Test with card `4242 4242 4242 4242`, any future expiry and any CVC.

### Going live

Repeat the setup with a live key in a live-mode account (the script refuses non-test keys, so adapt that guard
deliberately), store the live price IDs, and replace both Edge Function secrets. Review VAT handling before
charging real customers.
