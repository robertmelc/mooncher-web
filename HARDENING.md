# Hardening checklist před ostrým nasazením

Průběžně sbíraný seznam vědomě odložených rozhodnutí — věci, které fungují
pro současnou fázi (vizuál/struktura, testovací data), ale potřebují
dořešit před tím, než appka jde do produkce s reálnými penězi a klienty.

## 1. Auth Hook pro client_operator JWT claims

**Problém:** RLS politiky pro `client_operator` (na `vpc_client_users`,
`vpc_voucher_programs`, `vpc_accounts`, `vpc_ledger_entries`,
`vpc_transactions`, `vpc_vouchers`) čtou `client_id` z JWT `app_metadata`,
ale ten claim nikdy nevzniká — nemáme Auth Hook, který by ho při
přihlášení nastavil podle shody e-mailu ve `vpc_client_users`.

**Dočasné řešení:** všechny `/business` a `/admin` Route Handlery řeší
lookup i zápisy server-side přes service roli (`lib/business-auth.ts`,
`resolveClientOperator()`).

**Skutečné řešení:** Supabase Auth Hook (custom access token hook), který
při vytvoření session vloží `client_id` + `role` do `app_metadata` podle
shody e-mailu. Pak by šly Route Handlery nahradit přímými klientskými
dotazy chráněnými RLS, jak bylo v B4 navrženo.

Odkazy v kódu: `lib/business-auth.ts` (hlavní komentář).

---

## 2. Postgres RPC / row-level lock pro atomicitu finančních zápisů

**Problém:** Přesun mezi vouchery (obrazovka 07) i POS uplatnění
(obrazovka biz-8) jsou sekvence samostatných REST volání (fetch balance →
insert transaction → insert ledger entries), ne jedna DB transakce.
Supabase-js/PostgREST neumí víc-řádkovou atomickou transakci napřímo.

**Zmírněno teď:** `idempotency_key` (brání duplicitě ze stejného
kliknutí/retry) + u POS navíc optimistic-concurrency recheck těsně před
zápisem (ověří, že se zůstatek mezitím nezměnil). Zužuje riziko na
milisekundové okno, nezavírá ho úplně.

**Skutečné řešení:** Postgres funkce (RPC) s `SELECT ... FOR UPDATE` row
lockem, volaná přes `admin.rpc(...)` — zajistí atomicitu na úrovni
databáze.

Odkazy v kódu: `app/api/vouchers/transfer/route.ts`,
`app/api/business/pos/redeem/route.ts`.

---

## 3. Rate limiting na POS a aktivaci vouchru

**Problém:** B5 §7 dokumentuje konkrétní limity — 5 req/10 min/telefon pro
aktivaci, 30 req/min/API klíč pro POS redeem. Aktivace (obrazovka 06) má
jednoduchý DB-backed limiter přes `vpc_audit_log` (počet pokusů na token
za posledních N minut). POS (biz-8) rate limiting **nemá** — `vpc_audit_log`
nenese sloupec, který by umožnil efektivní "kolik pokusů za minutu udělal
tenhle klient" dotaz bez schema rozšíření.

**Skutečné řešení:** buď rozšířit `vpc_audit_log` o indexovatelný
`client_id`/`actor_id` sloupec pro rychlé okenní dotazy, nebo přesunout
rate limiting na infrastrukturní vrstvu (Upstash/Redis, Vercel Edge
Config).

Odkazy v kódu: `app/api/activate/[token]/route.ts` (má limiter),
`app/api/business/pos/redeem/route.ts` (nemá, komentář to zmiňuje).

---

## 4. `useEffect` závislost na celém `session` objektu

**Problém:** Skoro každá stránka v appce má vzorec
`useEffect(() => { loadData(); }, [session])`, kde `session` je celý
objekt ze Supabase Auth. Objekt mění referenci při každé obnově tokenu
(i neškodné, např. automatický refresh), což re-triggeruje efekt a
zbytečně znovu načte data. U většiny obrazovek je to jen neviditelný
zbytečný fetch — u `/admin` obrazovek, které audit-logují každé zobrazení
(viz bod adm-1), se to projeví jako duplicitní řádky v `vpc_audit_log`.

Objeveno při testování obrazovky adm-1 (Cashflow) — opakované vložení
stejné testovací session napříč restarty dev serveru vyvolalo smyčku
`onAuthStateChange`, která vytvořila desítky duplicitních audit log
záznamů (později smazaných, šlo o testovací data).

Znovu pozorováno při testování adm-6 (Audit log) — testovací tab
ponechaný otevřený na `/admin/clients/[id]` (adm-4) po dobu ~11 minut
vytvořil 22 duplicitních `admin.client_detail_viewed` záznamů na pozadí,
i bez jakékoli interakce. Potvrzuje, že jde o reálný, opakovatelný jev,
ne izolovanou náhodu z jednoho testu.

**Skutečné řešení:** nahradit `[session]` stabilnějším primitivem, např.
`session?.access_token` nebo `session?.user?.id`, napříč všemi stránkami
— rozsáhlejší refaktoring, ne bodová oprava jedné obrazovky.

---

## 5. Chybějící denní Edge Function pro LNE compliance (CZK→EUR)

**Problém:** `vpc_compliance_volume_snapshots` (B1 §6) je navržená tak, že
`total_volume_eur` a `threshold_pct` počítá a zapisuje denní scheduled job
(Supabase Edge Function + cron) — ten nikdy nevznikl, tabulka je prázdná.
Bez něj appka nemá žádný způsob, jak sledovat vyčerpání limitu 1 mil.
EUR/12 měsíců z LNE výjimky (právní brief) — metrika, na které přímo stojí
regulatorní pozice celé platformy.

Narazili jsme na to poprvé u obrazovky biz-2 (dashboard klienta — karta
"Vyčerpání limitu LNE" ukazuje natvrdo "Zatím nesledováno",
`app/business/page.tsx:132`), znovu u adm-3 (Compliance monitoring —
`app/api/admin/compliance/route.ts` dotazuje reálnou tabulku, ale ta je
prázdná, takže výsledek je stejný pro každého klienta).

**Proč to nejde obejít na rychlo:** klienti účtují v CZK, limit je v EUR.
Správný rolling 12měsíční přepočet potřebuje historický kurz ke dni každé
transakce, ne jeden "aktuální" kurz aplikovaný na celý součet zpětně — jinak
číslo jen vypadá důvěryhodně, ale je fakticky nesprávné. U právně podložené
metriky (ne interní analytiky) je nesprávné číslo horší než žádné, proto
obě obrazovky vědomě ukazují "nesledováno" místo dopočtu na místě.

**Skutečné řešení:** Supabase Edge Function na denním cronu, která pro
každého klienta: (1) sečte objem transakcí za posledních 12 měsíců podle
data, (2) převede na EUR kurzem platným k datu KAŽDÉ transakce (potřeba
spolehlivý zdroj historických kurzů, ne jen aktuální rate), (3) zapíše
`total_volume_eur` + `threshold_pct` do `vpc_compliance_volume_snapshots`,
(4) nastaví `alert_sent = true` při překročení 80 %, jak doporučuje B1 §6.

Odkazy v kódu: `app/business/page.tsx` (karta LNE),
`app/api/admin/compliance/route.ts`, `lib/compliance.ts`.

---

*Aktualizováno: obrazovka adm-3 (Compliance monitoring), 30. 7. 2026.*
