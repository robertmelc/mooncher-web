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

**Konkrétní potvrzený dopad (obrazovka 03, oprava `templates_select`,
1. 8. 2026):** `vpc_is_client_operator_for(client_id)` volá
`vpc_current_role()`/`vpc_current_client_id()` — obě čtou jen JWT claim,
co nikdy nevzniká. `vpc_current_role()` má navíc `coalesce` fallback na
`'end_user'`, takže funkce nehlásí chybu ani `null`, ale **potichu se
tváří, že přihlášený `client_operator` je ve skutečnosti `end_user`**.

Ověřeno naostro: reálný operátor Golden Blot (vlastník ve
`vpc_client_users`) nedokázal přímým RLS dotazem (anon klíč + jeho JWT,
ne přes appku) přečíst vlastní exkluzivní šablonu — `client_operator`
větev `templates_select` ho nepoznala. Stejná funkce se stejnými claims
je použitá i v `programs_select` a všude jinde, kde se `client_operator`
role v RLS politice objevuje (`vpc_client_users`, `vpc_voucher_programs`,
`vpc_accounts`, `vpc_ledger_entries`, `vpc_transactions`, `vpc_vouchers`)
— je tedy **stejně rozbitá všude**, ne jen na šablonách.

**Dnes appku nezasahuje**, protože veškerý `client_operator` přístup jde
výhradně přes Route Handlery se service rolí (bod výše) — přímý klientský
dotaz jako `client_operator` se v appce nikde nepoužívá. Je to ale past
pro budoucí kód: jakýkoli nový přímý RLS dotaz "jako client_operator" bude
tiše fungovat jako by byl `end_user` (uvidí míň, nebo jiná data, ne chybu),
dokud Auth Hook nevznikne. Skutečné řešení je stejné jako výše.

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

## 6. Chybějící HMAC podpis QR kódů (B4 §3)

**Problém:** B4 §3 popisuje `qr_payload`/`qr_signature` jako HMAC-SHA256
podepsané se secret_key per voucher program, uloženým v Supabase Vaultu —
server by při skenování přepočítal HMAC a porovnal, aby odhalil padělaný/
zmanipulovaný QR kód. Nic z týhle vrstvy nikde v appce neexistuje.

Aktivační "token" je dnes prostě syrové `vpc_vouchers.id` (žádný podpis),
POS lookup/redeem `qr_signature` vůbec nekontroluje. Obrazovka app-9
(Darovat voucher) je první místo, které `qr_payload`/`qr_signature`
skutečně GENERUJE (dřív vznikaly jen ručně přes SQL testovací fixtures) —
`lib/voucherIssuance.ts` proto používá zjevně označený placeholder
(`qr_payload = voucher.id`, `qr_signature` = SHA-256 hash bez secretu),
ne skutečný HMAC — stejný, už zavedený kompromis jako u aktivace/POS.

**Skutečné řešení:** HMAC-SHA256 nad `qr_payload` se secret_key z
Supabase Vault (per program), ověřováno při každém skenování/aktivaci.

Odkazy v kódu: `lib/voucherIssuance.ts`, `app/api/vouchers/gift/route.ts`.

---

## 7. Chybí SMS/e-mail transakční notifikační kanál

**Problém:** Appka nemá žádný způsob, jak automaticky doručit zprávu
mimo magic-link přihlášení (žádné SMS API, žádný transakční e-mailing).
`ONESIGNAL_APP_ID`/`ONESIGNAL_REST_API_KEY` v `.env.example` jsou
připravené proměnné z B7, ale nic je nevyužívá.

Poprvé se to reálně projevilo u app-9 (Darovat voucher) — po vytvoření
daru nejde příjemci automaticky poslat aktivační odkaz. Řešeno pro tuhle
fázi zobrazením odkazu odesílateli k ručnímu přeposlání (kopírování +
`navigator.share`), ne automatickým doručením.

**Skutečné řešení:** napojit transakční SMS bránu (Twilio/SMSbrana.cz)
a/nebo e-mail (SendGrid/Postmark) na `vpc_notifications_log` eventy
z B2 (`voucher_issued`, `voucher_activated`, `voucher_expiring_soon`...).

Odkazy v kódu: `app/app/vouchers/[id]/gift/page.tsx`.

---

## 8. RLS na exkluzivní šablony neumožňuje čtení end_userovi

**Problém:** B4 §1.2 dává čtení exkluzivních šablon (`owner_client_id`
vyplněné) jen `client_operator` (vlastníkovi) a `platform_admin` — ne
`end_user`. Když si klient v budoucnu nastaví program s exkluzivní
šablonou, end_user, co drží jeho voucher, by ji přímým klientským
dotazem nenačetl (RLS ho odmítne), a obrazovka 03 by potichu spadla na
`VoucherCard` fallback místo reálného designu — bezpečné chování, ale
nechtěné.

Objeveno při zapojování reálného renderu šablon do `/app/vouchers/[id]`
(obrazovka 03). Dnes bez dopadu — jediná existující šablona
("Mooncher Default") je sdílená (`owner_client_id is null`), tam RLS
čtení pro `end_user` funguje bez problémů.

**Skutečné řešení:** buď rozšířit RLS politiku o "end_user smí číst
šablonu, pokud drží voucher pod programem, co ji používá" (stejný vzorec
jako `programs_select` rozšíření pro `vpc_voucher_programs`), nebo načítat
šablonu přes Route Handler se service rolí místo přímého klientského
dotazu.

Odkazy v kódu: `app/app/vouchers/[id]/page.tsx`.

---

## 9. `vpc_end_users.auth_user_id` se nikde nezapisuje

**Problém:** Sloupec existuje a všechny end-user cesty podle něj *čtou*
(`app/api/vouchers/gift/route.ts`, `app/api/vouchers/transfer/route.ts`,
`app/app/page.tsx`, `app/app/settings/page.tsx`, `app/app/vouchers/[id]/*`,
`app/app/vouchers/transfer/page.tsx` — všechny `.eq("auth_user_id", ...)`),
ale nikde v appce se nenašel jediný `INSERT`/`UPDATE`, který by ho
nastavil. Dosavadní jediné místo, co `vpc_end_users` zakládá
(`app/api/activate/[token]/route.ts`, telefonní aktivace bez přihlášení),
píše výhradně podle `phone` — `auth_user_id` zůstává `null`. Důsledek: ani
jeden end_user založený běžnou aktivací dnes není přes žádnou z výše
uvedených cest dohledatelný, pokud se s ním někdo přihlásí přes magic
link — `/app` mu ukáže prázdný seznam vouchrů, ne chybu.

Objeveno při návrhu aktivace pro admin-vydané vouchery (přihlášením
gejtovaná varianta, `/admin/issue-voucher` → `/app/activate/[token]`,
2. 8. 2026) — tahle nová větev je **první místo v appce, které
`auth_user_id` skutečně zapisuje** (find-or-create `vpc_end_users` podle
přihlášeného `auth_user_id` místo podle telefonu).

**Proč to (zatím) nejde obejít plošně:** propojení účtu podle e-mailu při
prvním přihlášení je přesně to, co má dělat Auth Hook z bodu [#1](#1-auth-hook-pro-client_operator-jwt-claims)
(tam pro `client_operator`/`app_metadata`, tady analogicky pro
`end_user`/`vpc_end_users.auth_user_id`) — než ten vznikne, jakékoli
řešení tady je nutně bodové, ne systémové.

**Skutečné řešení:** až se bude řešit Auth Hook z bodu #1, ověřit soulad
s tímhle bodovým zápisem — ideálně stejný mechanismus (hook při
přihlášení najde/založí `vpc_end_users` podle e-mailu a nastaví
`auth_user_id`), který by pak zpětně obsloužil i telefonem založené
účty, ne jen ty vzniklé přes tuhle novou aktivaci.

Odkazy v kódu: `app/api/activate/[token]/route.ts` (nový branch pro
`requires_auth`), `lib/business-auth.ts` (analogický vzor pro
`client_operator`).

---

## 10. `POST /api/referral/[code]` nekontroluje ancestry, jen self-scan

**Problém:** Join endpoint odmítne jen dva případy — naskenování vlastního
kódu (`caller.id === referrer_end_user_id`) a existující jiný referrer
(`UNIQUE(client_id, referred_end_user_id)`). Nekontroluje, jestli referrer
kódu není náhodou **potomek** volajícího ve stejném stromu. Protože
`vpc_referral_links` garantuje max. jednoho referrera na osobu (jednou
propojený uzel už nejde přepojit), cyklus může vzniknout jen přes uzel,
který je zatím čistý kořen (sám nikdy nikým propojen nebyl) — pokud takový
kořen A později naskenuje kód někoho ve svém vlastním podstromu (např. Z,
kam se řetězec dostal přes A→B→C→Z), vznikne validní `INSERT`
`(referrer=Z, referred=A)`, a tím smyčka A→B→C→Z→A.

Objeveno při návrhu RPC funkce pro stromovou vizualizaci (Fáze 3
referral systému, 2. 8. 2026) — `referral_tree()` proto obsahuje
obrannou pojistku (`NOT referred_end_user_id = ANY(path)` v rekurzivní
CTE), takže i kdyby cyklus v datech vznikl, RPC nespadne do nekonečné
rekurze, jen ho na tom místě ořízne. Pojistka řeší jen zobrazení, ne
vznik cyklu v datech.

**Skutečné řešení:** v `POST /api/referral/[code]` před `INSERT` ověřit,
že volající (`caller.id`) není předek referrera — např. rekurzivním
dotazem "projdi řetězec referrerů od `row.referrer_end_user_id` nahoru,
narazíš na `caller.id`?" a při shodě join odmítnout stejnou hláškou jako
"Už jste propojen/a s jiným pozvatelem."

Odkazy v kódu: `app/api/referral/[code]/route.ts`, `referral_tree()` RPC
funkce (Fáze 3 stromové vizualizace).

---

*Aktualizováno: cyklová mezera v referral join endpointu (bod 10), 2. 8. 2026.*
