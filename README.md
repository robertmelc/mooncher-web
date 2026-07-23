# Mooncher

Voucherová platforma — Next.js 14 (App Router, TypeScript, Tailwind).

Kostra projektu podle B3 (technická architektura) z dokumentace B1–B8. Zatím bez napojení
na Supabase/Stripe/OneSignal — jen struktura tří rozhraní a placeholdery.

## Struktura

- `app/app/*` — koncový uživatel (peněženka, transaction feed) — viz B6 §1
- `app/business/*` — klient / B2B admin (voucher programy, šablony) — viz B6 §2
- `app/admin/*` — platform admin (cashflow, compliance) — viz B6 §3
- `middleware.ts` — placeholder pro role-based routing (B3 §1, B4 §1.1)
- `public/manifest.json` — PWA manifest placeholder (B3 §1)
- `.env.example` — proměnné z B7, zatím nevyplněné

## Vývoj

```bash
npm run dev
```

Otevři [http://localhost:3000](http://localhost:3000).
