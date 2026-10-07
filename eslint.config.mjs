import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Client-side Supabase queries and modal form resets intentionally synchronize state.
      'react-hooks/set-state-in-effect': 'off',
      // Calendar constraints are expected to follow the browser's current day.
      'react-hooks/purity': 'off',
      // Private, expiring Supabase signed URLs are rendered directly.
      '@next/next/no-img-element': 'off',
    },
  },
  // Edge Functions run on Deno with their own imports; they are not part of the Next.js build.
  globalIgnores(['.next/**', 'out/**', 'build/**', 'next-env.d.ts', 'supabase/functions/**']),
]);
