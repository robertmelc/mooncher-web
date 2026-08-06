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

## 10. `POST /api/referral/[code]` nekontroluje ancestry, jen self-scan (OPRAVENO)

**Problém:** Join endpoint odmítal jen dva případy — naskenování vlastního
kódu (`caller.id === referrer_end_user_id`) a existující jiný referrer
(`UNIQUE(client_id, referred_end_user_id)`). Nekontroloval, jestli referrer
kódu není náhodou **potomek** volajícího ve stejném stromu. Protože
`vpc_referral_links` garantuje max. jednoho referrera na osobu (jednou
propojený uzel už nejde přepojit), cyklus mohl vzniknout jen přes uzel,
který byl zatím čistý kořen (sám nikdy nikým propojen nebyl) — pokud takový
kořen A později naskenoval kód někoho ve svém vlastním podstromu (např. Z,
kam se řetězec dostal přes A→B→C→Z), vznikl validní `INSERT`
`(referrer=Z, referred=A)`, a tím smyčka A→B→C→Z→A.

Objeveno teoreticky při návrhu RPC funkce pro stromovou vizualizaci (Fáze 3
referral systému, 2. 8. 2026) — a **reálně se to samé odpoledne stalo** na
produkčních datech Golden Blot: Robert (`fbe158cc`) pozval hello@voucherons.com
(`039b250b`), ta si vygenerovala vlastní kód, a Robert ho zpětně naskenoval
při testování — vznikl 2-uzlový cyklus `fbe158cc ↔ 039b250b`. Důsledek byl
horší, než jen "cyklus v datech": `referral_tree()`'s definice kořene
("nikdy nikým nepropojen") vyřadila OBA uzly cyklu (každý byl "propojen" tím
druhým), takže rekurzivní CTE nemělo odkud začít a **celý strom Golden Blot
zmizel** (report: "strom je prázdný", 2. 8. 2026).

**Řešení (implementováno 2. 8. 2026):**
1. `POST /api/referral/[code]` teď před `INSERT` do `vpc_referral_links`
   volá `isAncestor()` — projde řetězec referrerů nahoru od
   `row.referrer_end_user_id` a odmítne join (`400`, "Tohle propojení by
   vytvořilo cyklus ve stromu pozvání."), pokud narazí na `caller.id`.
   Prevence do budoucna, ne oprava historických dat.
2. `referral_tree()` RPC je teď odolná vůči existujícímu cyklu i tak: kromě
   skutečných kořenů (nikdy nikým nepropojených) dopočítá i účastníky, na
   které se z žádného skutečného kořene nedá dojít (`reached` CTE), a udělá
   z nich záchranné syntetické kořeny — takže strom místo prázdna ukáže
   aspoň to, co jde. U vícečlenného cyklu se stejná větev může zobrazit
   vícekrát (jednou za každý neobsloužený uzel cyklu) — vědomý kompromis,
   řešení duplicit by vyžadovalo plnou detekci komponent grafu, což pro
   defenzivní fallback (hlavní prevence je bod 1) nestojí za složitost.
3. Historický cyklus na produkci (Golden Blot) vyřešen bodovým `DELETE`
   zpětného vztahu (ponechán organický směr, smazán testovací artefakt).

Odkazy v kódu: `app/api/referral/[code]/route.ts` (`isAncestor`,
`fetchReferrer`), `referral_tree()` RPC funkce (Fáze 3 stromové
vizualizace).

---

## 11. Doba uchovávání `chr_payout_claims` není definovaná

**Problém:** `chr_payout_claims` (charitativní vrstva, výherní listy) drží
jméno, číslo účtu a telefon výherce — citlivější kategorie údajů než
telefon u samotného losu. Appka dnes nemá žádný mechanismus na jejich
mazání po uplynutí doby, kterou má smysl je uchovávat (typicky dané
účetní/daňovou legislativou u dokladů k výplatě z nadačního fondu, ne
appkou samotnou).

**Proč to teď nejde vyřešit natvrdo:** přesná délka retence je právní/účetní
otázka (řádově roky, podle zákona o účetnictví/daňového řádu), ne technické
rozhodnutí — appka žádné číslo nevymýšlí, dokud ho nepotvrdí účetní klienta.
Appka navíc nemá žádnou infrastrukturu na scheduled/cron mazání (stejná
mezera jako u chybějícího LNE compliance jobu, bod #5) — i po potvrzení
retenční doby by šlo o novou, zatím neexistující schopnost.

**Zmírněno teď:** přístup k `chr_payout_claims` je striktně omezený —
RLS zapnuté bez politik (service-role only) a číslo účtu čte jen
`resolveAdmin()` gated route (platform_admin), ne `client_operator`.

**Skutečné řešení:** potvrdit s účetní Golden Blot (nebo obecně
klienta) přesnou retenční dobu, pak postavit scheduled mazání/anonymizaci
— ideálně spolu s bodem #5, až vznikne první scheduled-job infrastruktura
v appce, ať se neřeší dvakrát zvlášť.

Odkazy v kódu: `chr_payout_claims` tabulka, `app/api/admin/charity/claims/[id]/route.ts`.

---

## 12. GET route handlery bez čtení hlaviček/cookies/query — riziko zamrzlé odpovědi

**Problém:** Next.js App Router považuje GET route handler za staticky
cachovatelný, pokud během vykonání nesáhne na nic z requestu (hlavičky,
cookies, query parametry) — první odpověď se pak může "zamrznout" a appka
donekonečna vrací STEJNÁ data, i když se realita v DB mezitím změnila.
Dynamické segmenty v cestě (`[id]`) samy o sobě dynamické vykreslování
nevynucují — jen skutečné čtení z `Request` objektu ano.

Objeveno 6. 8. 2026 u `/api/win/[id]` (charitativní vrstva, výherní list) —
appka po zneplatnění listu dál veřejně hlásila "čeká na uplatnění" místo
"zneplatněno", protože GET handler nečetl nic z requestu. Oprava:
`export const dynamic = "force-dynamic";`.

**Kompletní audit (6. 8. 2026)** — všech 28 GET route handlerů v appce,
ručně, ne jen grepem (parametry cesty typu `[id]` se nepočítají, jen
skutečné čtení `req.headers`/`req.cookies`/`req.nextUrl.searchParams`):

**Potvrzeně postižené stejným vzorem (`_req` nepoužitý, nic z requestu se
nečte):**
- `app/api/win/[id]/route.ts` — **OPRAVENO** 6. 8. 2026. Veřejný náhled
  výherního listu. Zamrzlá odpověď by znamenala, že zneplatněný/uplatněný
  list dál svítí jako platný — reálné riziko u peněz, přesně tenhle
  případ appku na chybu upozornil.
- `app/api/referral/[code]/route.ts` — **OPRAVENO** 6. 8. 2026 (údržba
  jádra platformy, samostatný commit). Veřejný náhled referral pozvánky
  (`clientName`/`referrerName`). Nižší praktická závažnost — tahle data
  se prakticky nemění po vzniku kódu — ale stejná třída chyby.
- `app/api/activate/[token]/route.ts` — **OPRAVENO** 6. 8. 2026 (údržba
  jádra platformy, samostatný commit). Veřejný náhled aktivace vouchru
  (`issuedToName`, `message`, jestli je voucher ještě volný k aktivaci —
  `voucher.status !== "issued" || voucher.account_id`). Zamrzlá odpověď by
  mohla ukazovat voucher jako "ještě volný k aktivaci" i poté, co ho někdo
  mezitím aktivoval — zavádějící UX, samotná aktivace (`POST`) si stav
  ověřuje znovu z DB, takže nešlo o bezpečnostní díru, jen o matoucí náhled.
  Ze všech nalezených nejblíž penězům/reálným voucherům — proto opraveno
  hned, přestože byla nalezena při tomhle auditu, ne kvůli nahlášenému
  problému (na rozdíl od `win/[id]`, kde appku na chybu upozornil reálný
  test zneplatnění).

**Zbylých 25 GET handlerů** (`/api/admin/*`, `/api/business/*`,
`/api/vouchers/[id]/referral*`) skutečně čtou `Authorization` hlavičku —
buď přímo v těle GET funkce, nebo přes sdílenou `resolveAdmin()` /
`resolveClientOperator()` / `resolveContext()`, které dostávají živý
request/token a hlavičku čtou uvnitř. To by mělo Next.js donutit renderovat
dynamicky (sleduje skutečné použití API na požadavku, ne text souboru) —
ale u těch, co čtou přes sdílenou funkci (`vouchers/[id]/referral/route.ts`,
`.../invites/route.ts`), to nebylo empiricky ověřeno stejným
"rozbij a oprav" testem jako u předchozích tří, jen odvozeno z toho, jak
Next.js dynamiku detekuje. Nižší jistota, ale žádný z nich není veřejný
(všechny vyžadují platnou session), takže i kdyby cachovaly, dopad by byl
"vidím svoje vlastní stará data", ne cizí/citlivá.

**Skutečné řešení:** u zbylých dvou neověřených (`vouchers/[id]/referral/route.ts`,
`.../invites/route.ts`) provést stejný "rozbij a oprav" test, ne se
spokojit s odvozením — u všech tří dosud potvrzených případů odhad seděl,
ale to je důvod nespěchat, ne důvod to natrvalo neověřit.

Odkazy v kódu: viz seznam výše.

---

## 13. Vícevydavatelské čerpání se skupinovým doplatkem — částečné selhání napříč firmami

**Problém:** existující riziko z bodu #2 (sekvence REST volání, ne jedna DB
transakce) se u vícevydavatelských karet netýká jen jednoho účtu, ale
klidně tří najednou — čerpání s doplatkem zapisuje odečet na vlastním
účtu operátorova klienta A odečet na účtu firmy, co doplácí. Pokud appka
spadne mezi těmito dvěma zápisy, vznikne stav, který dosavadní riziko
nezná: dva různé PRÁVNÍ SUBJEKTY mají neshodující se účetnictví mezi
sebou, ne jen jedna appka nekonzistentní se svým vlastním voucherem.
Proto samostatná položka, ne rozšíření #2.

**Zmírněno teď:**
1. `vpc_inter_issuer_settlements` řádek (evidence dluhu) vzniká VÝHRADNĚ
   po úspěchu všech odečtů dané transakce — nikdy dřív. Stejně tak
   `vpc_redemptions`.
2. Pokud kterýkoli odečet uprostřed sekvence selže, appka nezkouší nic
   "vrátit zpět" (nemá jak — stejné omezení jako #2), ale vrátí operátorovi
   čestnou chybu ("Uplatnění se nedokončilo, kontaktujte podporu.") a
   zapíše do `vpc_audit_log` `action: "voucher.redemption_torn"` s
   `transactionId` — ať je roztržený stav dohledatelný, ne tichý.
3. Detekční dotaz pro podporu/reconciliaci: `vpc_ledger_entries` řádky
   navázané na `transaction_id`, ke kterému NEEXISTUJE odpovídající
   `vpc_redemptions` řádek = roztržená transakce, potřebuje ruční kontrolu.
   Tenhle signál appka (mlčky) používala už u jednoúčtového čerpání dřív,
   jen teď má vyšší váhu, protože jde o víc firem najednou.
4. Doplácení mezi firmami NENÍ automatické — appka ho jen nabídne
   (`needsGroupSettlement`), operátor musí výslovně potvrdit
   (`confirmGroupSettlement`) v samostatném požadavku. Snižuje frekvenci
   týhle cesty kódu vůbec (spouští se jen při vědomém potvrzení, ne při
   každém čerpání), ne pravděpodobnost částečného selhání v ní.

**Skutečné řešení:** stejné jako #2 — Postgres RPC s row-level lockem
(`SELECT ... FOR UPDATE`) přes všechny zapojené účty najednou v jedné
skutečné DB transakci. Odloženo do hardening fáze, teď zmírněno na
"detekovatelné a dohledatelné", ne "vyloučené".

Odkazy v kódu: `app/api/business/pos/redeem/route.ts` (větev
`multi_issuer_program_id`), `vpc_inter_issuer_settlements` tabulka.

**Tři chyby nalezené při ověřování (6. 8. 2026), ne hlášeným problémem:**
1. **Dvojí započtení doplatku (OPRAVENO).** Odečet vlastního účtu ve větvi
   `confirmGroupSettlement` používal `amount` (celou požadovanou částku)
   místo `ownBalance` (jen vlastní podíl) — vlastní účet se odečetl o celou
   částku a doplácející firmy JEŠTĚ ZVLÁŠŤ o svůj podíl navíc. Empiricky
   potvrzeno: 900 Kč čerpání s vlastním zůstatkem 600 Kč poslalo vlastní
   účet do −300. Viz i bod #15 níž — přesně tahle třída chyby je důvod, proč
   teď existuje `CHECK (balance_after >= 0)`.
2. **Nulový odečet při vyčerpaném vlastním účtu (OPRAVENO).** Když je
   `ownBalance` přesně 0 (účet firmy už nemá co čerpat), kód se pokoušel
   zapsat odečet o částce 0 — `CHECK (vpc_ledger_entries_amount_check)` ho
   odmítl a celá transakce se čestně "roztrhla" (žádný částečný zápis,
   ale doplatek neprošel vůbec). Oprava: když je vlastní podíl 0, appka ho
   do hlavní knihy vůbec nezapisuje, doplatek jde celý ze skupiny.
3. **Syrová chyba databáze při souběžném dvojkliku (OPRAVENO).** `idempotency_key`
   má `UNIQUE` na `vpc_transactions`, takže i dva požadavky vyslané doopravdy
   současně (ne po sobě) zapíšou odečet jen jednou — druhý insert transakce
   selže dřív, než se cokoli odečte z hlavní knihy. Data byla tedy vždycky
   v pořádku, ale prohraný požadavek dostal zpátky syrovou Postgres chybu
   (`duplicate key value violates unique constraint...`) místo srozumitelné
   odpovědi — a taková chyba navíc prozrazuje obsluze vnitřní strukturu
   databáze. Oprava: kód `23505` se teď pozná a vrátí stejné
   `{ok:true, alreadyProcessed:true}` jako sekvenční dvojklik. Stejná oprava
   aplikována i na jednovydavatelskou větev (samostatný commit, údržba
   jádra — viz git historie).

Ověřeno po opravě: sekvenční i skutečně souběžný dvojitý požadavek vždy
zapíše odečet přesně jednou. Edge-case kolo (6. 8. 2026): částka přesně
rovná vlastnímu zůstatku (jednoduchá cesta, ne skupinový doplatek), částka
přesně rovná celkovému zůstatku karty (vyčerpá všechny firmy do nuly,
status přejde na `used`), karta se zůstatkem jen u jedné firmy (jak
čerpání zevnitř té firmy, tak doplatek odjinud s vlastním podílem 0), a
doplatek přesahující i součet všech ostatních firem (odmítnuto, nulový
zápis do databáze) — všechno sedí.

---

## 14. "Karta má vždycky aspoň jeden účet" už negarantuje databáze, ale appka

**Problém:** `vpc_vouchers.account_id` byl dřív efektivně vždy vyplněný
(kromě krátkého okna u dárkových/admin-vydaných voucherů před aktivací,
`status='issued'`) — CHECK constraint `vpc_vouchers_account_required_unless_pending_gift`
to hlídal. Kvůli vícevydavatelským kartám (žádný jednotný `account_id`,
hodnota žije ve `vpc_voucher_issuer_accounts`) jsme constraint rozšířili
o třetí legální případ: `multi_issuer_program_id IS NOT NULL`. To ale
znamená, že databáze už NEGARANTUJE, že taková karta má vůbec nějaký
skutečný účet — teoreticky by šlo mít `vpc_vouchers` řádek s
`multi_issuer_program_id` vyplněným a nulou řádků v
`vpc_voucher_issuer_accounts` k němu.

**Zmírněno teď (aplikační vrstva, ne databáze):**
1. Vydávací route (`POST /api/admin/multi-issuer/issue`) odmítne program
   s méně než dvěma členy hned na vstupu — "vícevydavatelský" znamená
   aspoň dva, ne jeden.
2. `vpc_voucher_issuer_accounts` se zapisují hned po založení
   `vpc_vouchers` řádku, PŘED transakcí/ledgerem, a appka ověří, že vzniklo
   přesně tolik řádků, kolik má program členů — ne "nějaké".
3. Při selhání (chyba zápisu, nebo počet řádků nesedí) appka rovnou smaže
   právě založený `vpc_vouchers` řádek (kompenzační úklid — appka nemá
   skutečnou DB transakci napříč REST voláními, stejné omezení jako #2/#13)
   a vrátí chybu, ať nikdy nevznikne karta bez účtů.

**Skutečné řešení:** stejné jako u #2/#13 — Postgres RPC/DB transakce by
tohle vynucovalo na úrovni databáze znovu, ne aplikační konvencí, která
se dá při budoucí úpravě kódu omylem obejít.

Odkazy v kódu: `app/api/admin/multi-issuer/issue/route.ts`. Definice
constraintu nese od 8/2026 i `COMMENT ON CONSTRAINT` vysvětlující obě
NULL výjimky, ať jméno ("account required unless pending gift") za rok
nemate u třetí, novější výjimky.

---

## 15. `CHECK (balance_after >= 0)` na `vpc_ledger_entries`

**Proč vznikl:** ověřování vícevydavatelského čerpání (bod #13) odhalilo
skutečnou chybu, která poslala účet do záporného zůstatku (−300 Kč) —
u voucherů/kont v týhle appce nemá záporný zůstatek nikdy žádný smysl,
takže se nemá o co přijít tím, že to appka natvrdo zakáže na úrovni
databáze, ne jen spoléháním na to, že appkový kód bude vždycky správný.

**Řešení (spuštěno 6. 8. 2026):**
```sql
ALTER TABLE vpc_ledger_entries
  ADD CONSTRAINT vpc_ledger_entries_balance_after_non_negative
  CHECK (balance_after >= 0) NOT VALID;
```
`NOT VALID` = nekontroluje historické řádky (viz nález níž), ale hlídá
úplně každý nový zápis od chvíle spuštění — žádná appková logika ho nejde
obejít, protože běží v databázi, ne v appce.

**Vedlejší přínos, který stojí za vypíchnutí:** tohle je past do budoucna.
Kdyby se stejná třída chyby jako ta z bodu #13 (dvojí započtení doplatku)
objevila znovu — ať už novým bugem, nebo souběhem, který appka nestihla
ošetřit — appka to dřív potichu zapsala jako záporné číslo. Teď takový
zápis nahlas selže (`23514`, přesně jak to zachytil test v bodě #13) a
appka to má už dnes ošetřené jako běžné selhání zápisu (čestná chyba,
`voucher.redemption_torn` audit signál) — ne jako tichou, nepozorovanou
korupci dat.

**Historický nález, který `ADD CONSTRAINT` zablokoval a musel se obejít
přes `NOT VALID`:** `vpc_ledger_entries.id=12`, účet `cfe13ba6...`
(robert.melc@gmail.com, program "Ambassador", voucher `GB-AMB-0001`),
první záznam v hlavní knize toho účtu je odečet 300 Kč rovnou do
`balance_after = -300`, `created_at 2026-07-30T08:46:21`.

**Vyšetřeno (6. 8. 2026), jestli cesta, co to vyrobila, ještě žije:**
- Jednovydavatelská POS redeem route (jediné místo v appce, co píše
  transakce typu `redeem`) má kontrolu `amount > balance` → 400 už od
  svého jediného commitu (`bc2bdbb`, 2026-07-29 17:21) — tedy DŘÍV, než
  vadný řádek vznikl (2026-07-30 08:46). Živá appková cesta v tu chvíli
  už zůstatek hlídala.
- `vpc_audit_log` v okně ±10 minut kolem vzniku řádku neobsahuje žádný
  `voucher.redeemed`/`voucher.redemption_rejected`/`voucher.redemption_torn`
  záznam — jen běžné prohlížení admin stránek. Appka při skutečném čerpání
  audit log VŽDY zapisuje; jeho nepřítomnost je silný signál, že tenhle
  zápis appkou vůbec neprošel.
- Metadata transakce jsou prázdná (`{}`) — živá redeem route je vždy plní
  aspoň `{voucher_id: ...}`.
- `vpc_voucher_programs.created_at` (program "Ambassador") a první ledger
  řádek toho účtu mají identický timestamp na mikrosekundu — typický
  otisk dávkově vloženého seed/demo řádku, ne organického použití appky
  postupně v čase.

**Závěr:** shoda důkazů ukazuje na ruční/skriptem vložená data z rané fáze
vývoje (demo karta pro náhled šablony "Ambassador"), ne na živou appkovou
chybu. Podle rozhodnutí (6. 8. 2026) řádek zůstává nedotčený — je to
známý, zdokumentovaný dluh ve starých datech, ne otevřené riziko.

Odkazy v kódu: `app/api/business/pos/redeem/route.ts` (obě větve,
`vpc_ledger_entries.insert`), `lib/ledger.ts`.

---

## 16. Testovací data vícevydavatelských karet v produkční databázi — smazat před nasazením na reálnou skupinu

**Problém:** ověřování bodů #13–15 vzniklo přímo v produkční databázi
(žádné jiné prostředí appka zatím nemá) a část toho, co vzniklo, je
záměrně ponechaná jako trvalé demo, ne uklizená po testu:

- `vpc_clients`: **TEST Hotel**, **TEST Restaurace**, **TEST Wellness**
  (`contact_email` `test-hotel@example.com` / `test-restaurace@example.com`
  / `test-wellness@example.com`).
- `vpc_voucher_programs`: TEST Hotel karta, TEST Restaurace karta,
  TEST Wellness karta (`network_scope.merchant_ids` s prefixem `test-`).
- `vpc_client_groups`: "TEST Skupina (Royal Spa vzor)" +
  `vpc_client_group_members` (settlement_priority hotel/restaurace/wellness
  1/2/3).
- `vpc_multi_issuer_programs`: "TEST Lázeňská karta" (50/30/20 split) +
  `vpc_multi_issuer_program_members`.
- `vpc_client_users` (operátoři): `qa.multiissuer.hotel@example.com`,
  `qa.multiissuer.restaurace@example.com`, `qa.multiissuer.wellness@example.com`.
- Karta **MULTI-ACZ3DK** (voucher, jeho `vpc_voucher_issuer_accounts`,
  `vpc_ledger_entries`, `vpc_redemptions`, `vpc_inter_issuer_settlements`)
  — držena záměrně v čistém, ne poškozeném stavu jako živé demo funkce
  (rozpis podle firem, vyrovnaný i nevyrovnaný dluh v přehledu).

**Proč to appka nesmí prostě smazat sama:** je to jediná skupina s víc
firmami, na které funkce vůbec něco ukáže — bez ní `/admin/multi-issuer`,
`/admin/settlements` i detail karty v `/app` nemají na čem předvést, že
fungují. Smazat rovnou při dokončení práce by znamenalo nechat funkci bez
jediného ověřitelného příkladu v appce.

**Skutečné řešení:** až vznikne první SKUTEČNÁ skupina (reálné firmy,
podepsaná dohoda — viz i explicitní instrukce z návrhové fáze: "Dokud není
dohoda podepsaná, nechci mít v produkční databázi jejich strukturu"),
smazat všechno vyjmenované výše. Bez tohohle zápisu to nemá kdo připomenout
— appka žádnou "je tohle ještě potřeba" kontrolu nemá a nemůže mít, jde
o obchodní rozhodnutí, ne technické.

Odkazy v kódu: žádné (čistě datová položka) — týká se tabulek
`vpc_clients`, `vpc_voucher_programs`, `vpc_client_groups`,
`vpc_client_group_members`, `vpc_multi_issuer_programs`,
`vpc_multi_issuer_program_members`, `vpc_client_users`, `vpc_vouchers`
a navázaných `vpc_voucher_issuer_accounts` / `vpc_ledger_entries` /
`vpc_redemptions` / `vpc_inter_issuer_settlements`.

---

*Aktualizováno: vícevydavatelské karty — tři chyby nalezené a opravené při ověřování (bod 13), CHECK proti zápornému zůstatku (bod 15), testovací data k úklidu před ostrým nasazením (bod 16), 8. 2026.*
