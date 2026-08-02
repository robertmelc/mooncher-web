"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";
import { VoucherCard } from "@/components/VoucherCard";
import { Button } from "@/components/Button";
import { formatCurrency } from "@/lib/format";
import { voucherStatusLabel, voucherEyebrow } from "@/lib/vouchers";
import {
  renderTemplateHtml,
  defaultTokenValues,
  type TokenSchema,
} from "@/lib/renderTemplate";

type VoucherWithProgram = {
  id: string;
  code: string;
  status: string;
  account_id: string;
  valid_until: string | null;
  message: string | null;
  is_admin_issued: boolean;
  voucher_program: {
    name: string;
    voucher_type: string;
    currency: string;
    design_config: { template_id?: string; tokens?: Record<string, string> } | null;
    client: { name: string } | null;
  } | null;
};

type VoucherDetail = {
  id: string;
  eyebrow: string;
  title: string;
  subtitle: string;
  amount: string;
  code: string;
  status: string;
  validUntil?: string;
  message?: string;
};

type TemplateData = {
  front_layout: string;
  back_layout: string;
  token_schema: TokenSchema;
  designTokens: Record<string, string>;
};

type ReferralLevel = { id: string; name: string; threshold: number };
type ReferralStatus = {
  enabled: boolean;
  code?: string | null;
  directCount?: number;
  currentLevel?: ReferralLevel | null;
  nextLevel?: ReferralLevel | null;
};

export default function VoucherDetailPage({ params }: { params: { id: string } }) {
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [voucher, setVoucher] = useState<VoucherDetail | null | undefined>(undefined);
  const [template, setTemplate] = useState<TemplateData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flipped, setFlipped] = useState(false);

  const [referral, setReferral] = useState<ReferralStatus | null>(null);
  const [creatingInvite, setCreatingInvite] = useState(false);

  useEffect(() => {
    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthLoading(false);
    });

    return () => {
      listener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!session) return;

    async function loadVoucher() {
      const { data: endUser, error: endUserError } = await supabase
        .from("vpc_end_users")
        .select("id")
        .eq("auth_user_id", session!.user.id)
        .maybeSingle();

      if (endUserError) {
        setError(`Chyba při čtení vpc_end_users: ${endUserError.message}`);
        return;
      }
      if (!endUser) {
        setVoucher(null);
        return;
      }

      const { data: accounts, error: accountsError } = await supabase
        .from("vpc_accounts")
        .select("id")
        .eq("end_user_id", endUser.id);

      if (accountsError) {
        setError(`Chyba při čtení vpc_accounts: ${accountsError.message}`);
        return;
      }

      const ownAccountIds = new Set((accounts ?? []).map((a) => a.id));
      if (ownAccountIds.size === 0) {
        setVoucher(null);
        return;
      }

      const { data: voucherRow, error: voucherError } = await supabase
        .from("vpc_vouchers")
        .select(
          `id, code, status, account_id, valid_until, message, is_admin_issued,
           voucher_program:vpc_voucher_programs (
             name, voucher_type, currency, design_config,
             client:vpc_clients ( name )
           )`
        )
        .eq("id", params.id)
        .maybeSingle();

      if (voucherError) {
        setError(`Chyba při čtení vpc_vouchers: ${voucherError.message}`);
        return;
      }

      const row = voucherRow as unknown as VoucherWithProgram | null;

      // Defense in depth: i kdyby RLS omylem propustila cizí řádek, ověříme
      // vlastnictví i tady — cizí/neexistující voucher se chová stejně jako "nenalezeno".
      if (!row || !row.voucher_program || !ownAccountIds.has(row.account_id)) {
        setVoucher(null);
        return;
      }

      const { data: ledgerEntries, error: ledgerError } = await supabase
        .from("vpc_ledger_entries")
        .select("balance_after, created_at")
        .eq("account_id", row.account_id)
        .order("created_at", { ascending: false })
        .limit(1);

      if (ledgerError) {
        setError(`Chyba při čtení vpc_ledger_entries: ${ledgerError.message}`);
        return;
      }

      const balance = ledgerEntries?.[0] ? Number(ledgerEntries[0].balance_after) : 0;
      const program = row.voucher_program;

      setVoucher({
        id: row.id,
        eyebrow: voucherEyebrow(program.voucher_type, row.is_admin_issued),
        title: program.name,
        subtitle: program.client?.name ?? "",
        amount: formatCurrency(balance, program.currency),
        code: row.code,
        status: voucherStatusLabel(row.status),
        validUntil: row.valid_until
          ? new Date(row.valid_until).toLocaleDateString("cs-CZ")
          : undefined,
        message: row.message ?? undefined,
      });

      // Reálná šablona jen na detailu (03) — viz konverzace k render logice.
      // Fallback (žádný stav) necháváme, pokud program nemá design_config
      // nastavený, nebo šablonu z nějakého důvodu nejde načíst.
      const templateId = program.design_config?.template_id;
      if (templateId) {
        const { data: templateRow } = await supabase
          .from("vpc_voucher_templates")
          .select("front_layout, back_layout, token_schema")
          .eq("id", templateId)
          .maybeSingle();

        if (templateRow) {
          setTemplate({
            front_layout: templateRow.front_layout,
            back_layout: templateRow.back_layout,
            token_schema: templateRow.token_schema as TokenSchema,
            designTokens: program.design_config?.tokens ?? {},
          });
        }
      }
    }

    loadVoucher();
  }, [session, params.id]);

  useEffect(() => {
    if (!session?.access_token) return;

    async function loadReferral() {
      const res = await fetch(`/api/vouchers/${params.id}/referral`, {
        headers: { Authorization: `Bearer ${session!.access_token}` },
      });
      const json = await res.json();
      if (res.ok) {
        setReferral(json);
      }
    }

    loadReferral();
    // session je tu záměrně mimo dependency array — HARDENING.md #4.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id, params.id]);

  async function handleGetInviteLink() {
    if (!session) return;
    setCreatingInvite(true);

    const res = await fetch(`/api/vouchers/${params.id}/referral`, {
      method: "POST",
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    const json = await res.json();
    setCreatingInvite(false);

    if (res.ok) {
      setReferral(json);
    }
  }

  const inviteUrl =
    referral?.code && typeof window !== "undefined" ? `${window.location.origin}/app/join/${referral.code}` : null;

  async function handleCopyInvite() {
    if (!inviteUrl) return;
    await navigator.clipboard.writeText(inviteUrl);
  }

  async function handleShareInvite() {
    if (!inviteUrl) return;
    if (navigator.share) {
      await navigator.share({ title: "Pozvánka", url: inviteUrl });
    }
  }

  const templateRenderHtml =
    voucher && template
      ? renderTemplateHtml(flipped ? template.back_layout : template.front_layout, {
          ...defaultTokenValues(template.token_schema),
          ...template.designTokens,
          eyebrow: voucher.eyebrow,
          amount: voucher.amount,
          code: voucher.code,
          valid_until: voucher.validUntil ? `Platnost do ${voucher.validUntil}` : "Bez expirace",
        })
      : null;

  return (
    <main className="min-h-screen px-5 py-10">
      <div className="mx-auto flex max-w-md flex-col gap-5">
        <header className="flex items-center gap-3">
          <Link
            href="/app"
            className="flex h-8 w-8 items-center justify-center rounded-sm border border-line-strong text-ink-dim"
            aria-label="Zpět"
          >
            ‹
          </Link>
          <h1 className="font-display text-xl font-bold tracking-tight">Detail voucheru</h1>
        </header>

        {authLoading ? (
          <p className="font-mono text-sm text-ink-dim">Ověřuji přihlášení…</p>
        ) : !session ? (
          <p className="font-mono text-sm text-ink-dim">
            Nejste přihlášeni —{" "}
            <Link
              href={`/app/login?next=${encodeURIComponent(`/app/vouchers/${params.id}`)}`}
              className="text-teal underline"
            >
              přihlásit se
            </Link>
          </p>
        ) : error ? (
          <p className="font-mono text-sm text-danger">{error}</p>
        ) : voucher === undefined ? (
          <p className="font-mono text-sm text-ink-dim">Načítám voucher…</p>
        ) : voucher === null ? (
          <div className="rounded-sm border border-dashed border-line-strong p-6 text-center text-sm text-ink-faint">
            Voucher nenalezen.
          </div>
        ) : (
          <>
            {templateRenderHtml !== null ? (
              <div dangerouslySetInnerHTML={{ __html: templateRenderHtml }} />
            ) : (
              <VoucherCard {...voucher} flipped={flipped} />
            )}

            <div className="flex justify-center">
              <span className="badge">{voucher.status}</span>
            </div>

            {voucher.message && (
              <p className="rounded-sm border border-dashed border-line-strong px-3.5 py-2.5 text-center text-[12.5px] italic text-ink-dim">
                „{voucher.message}“
              </p>
            )}

            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setFlipped((f) => !f)}
                className="rounded-sm border border-dashed border-line-strong px-3.5 py-2 text-center text-[11.5px] font-medium text-ink-dim"
              >
                ↻ Otočit kartu
              </button>
              <Link
                href={`/app/vouchers/${voucher.id}/history`}
                className="rounded-sm border border-dashed border-line-strong px-3.5 py-2 text-center text-[11.5px] font-medium text-ink-dim"
              >
                Historie
              </Link>
              <Link
                href={`/app/vouchers/${voucher.id}/load`}
                className="rounded-sm border border-dashed border-line-strong px-3.5 py-2 text-center text-[11.5px] font-medium text-ink-dim"
              >
                Nabít
              </Link>
              <Link
                href="/app/vouchers/transfer"
                className="rounded-sm border border-dashed border-line-strong px-3.5 py-2 text-center text-[11.5px] font-medium text-ink-dim"
              >
                Přesun
              </Link>
              <Link
                href={`/app/vouchers/${voucher.id}/gift`}
                className="col-span-2 rounded-sm border border-dashed border-line-strong px-3.5 py-2 text-center text-[11.5px] font-medium text-ink-dim"
              >
                Darovat
              </Link>
            </div>

            {!flipped && (
              <div className="flex flex-col items-center gap-3">
                <div className="qr" aria-hidden="true" />
                <p className="text-[11.5px] text-ink-dim">Naskenujte u pokladny</p>
              </div>
            )}

            {referral?.enabled && (
              <div className="flex flex-col gap-2.5 rounded-sm border border-line-strong p-4">
                <div className="flex items-center justify-between">
                  <span className="text-[11.5px] text-ink-faint">Pozvánkový program</span>
                  {referral.currentLevel && <span className="badge">{referral.currentLevel.name}</span>}
                </div>
                <p className="text-[11.5px] text-ink-dim">
                  {referral.directCount ?? 0} přímých pozvání
                  {referral.nextLevel &&
                    ` · do ${referral.nextLevel.name} zbývá ${referral.nextLevel.threshold - (referral.directCount ?? 0)}`}
                </p>
                {referral.code ? (
                  <>
                    <p className="break-all rounded-sm bg-panel2 px-3 py-2 font-mono text-[11px] text-ink-dim">
                      {inviteUrl}
                    </p>
                    <div className="flex gap-2">
                      <Button variant="ghost" className="flex-1" onClick={handleCopyInvite}>
                        Kopírovat odkaz
                      </Button>
                      <Button className="flex-1" onClick={handleShareInvite}>
                        Sdílet
                      </Button>
                    </div>
                  </>
                ) : (
                  <Button onClick={handleGetInviteLink} disabled={creatingInvite}>
                    {creatingInvite ? "Vytvářím…" : "Získat pozvánkový odkaz"}
                  </Button>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
