"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";
import { BusinessShell } from "@/components/BusinessShell";
import { Button } from "@/components/Button";
import { formatCurrency } from "@/lib/format";
import { voucherStatusLabel } from "@/lib/vouchers";

type FoundVoucher = {
  id: string;
  code: string;
  status: string;
  programName: string;
  currency: string;
  balance: number;
  isMultiIssuer?: boolean;
  totalBalance?: number;
  clientName?: string;
};

type DrawPlanEntry = { clientId: string; clientName: string; amount: number };
type GroupSettlementOffer = {
  ownBalance: number;
  shortfall: number;
  totalAvailable: number;
  drawPlan: DrawPlanEntry[];
};

export default function PosPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [isOperator, setIsOperator] = useState<boolean | undefined>(undefined);

  const [code, setCode] = useState("");
  const [looking, setLooking] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [voucher, setVoucher] = useState<FoundVoucher | null>(null);

  const [amount, setAmount] = useState("");
  const [redeeming, setRedeeming] = useState(false);
  const [redeemResult, setRedeemResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [groupSettlementOffer, setGroupSettlementOffer] = useState<GroupSettlementOffer | null>(null);
  const [pendingIdempotencyKey, setPendingIdempotencyKey] = useState<string | null>(null);

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

    async function loadOperator() {
      const res = await fetch("/api/business/operator", {
        headers: { Authorization: `Bearer ${session!.access_token}` },
      });
      setIsOperator(res.ok);
    }

    loadOperator();
  }, [session]);

  async function handleLookup(e: React.FormEvent) {
    e.preventDefault();
    if (!session || !code.trim()) return;

    setLooking(true);
    setLookupError(null);
    setVoucher(null);
    setRedeemResult(null);
    setGroupSettlementOffer(null);
    setPendingIdempotencyKey(null);
    setAmount("");

    const res = await fetch(`/api/business/pos/lookup?code=${encodeURIComponent(code.trim())}`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    const json = await res.json();

    setLooking(false);

    if (!res.ok) {
      setLookupError(json.error ?? "Voucher nenalezen.");
      return;
    }

    setVoucher(json.voucher);
  }

  async function handleRedeem() {
    if (!session || !voucher) return;

    const numericAmount = Number(amount);
    if (!numericAmount || numericAmount <= 0) {
      setRedeemResult({ ok: false, message: "Zadejte platnou částku." });
      return;
    }

    setRedeeming(true);
    setRedeemResult(null);
    setGroupSettlementOffer(null);

    const idempotencyKey = crypto.randomUUID();
    setPendingIdempotencyKey(idempotencyKey);

    const json = await submitRedeem(numericAmount, idempotencyKey, false);
    setRedeeming(false);
    if (!json) return;

    if (json.needsGroupSettlement) {
      // Appka JEN NABÍZÍ doplatek ze skupiny — nezapisuje nic, dokud
      // obsluha výslovně nepotvrdí, viz konverzace k vícevydavatelským kartám.
      setGroupSettlementOffer({
        ownBalance: json.ownBalance,
        shortfall: json.shortfall,
        totalAvailable: json.totalAvailable,
        drawPlan: json.drawPlan,
      });
      return;
    }

    if (!json.ok) {
      setRedeemResult({ ok: false, message: json.error ?? "Uplatnění se nezdařilo." });
      return;
    }

    applyRedeemSuccess(json);
  }

  async function handleConfirmGroupSettlement() {
    if (!session || !voucher || !pendingIdempotencyKey) return;
    const numericAmount = Number(amount);

    setRedeeming(true);
    setRedeemResult(null);

    const json = await submitRedeem(numericAmount, pendingIdempotencyKey, true);
    setRedeeming(false);
    if (!json) return;

    if (!json.ok) {
      setRedeemResult({ ok: false, message: json.error ?? "Uplatnění se nezdařilo." });
      return;
    }

    setGroupSettlementOffer(null);
    applyRedeemSuccess(json);
  }

  async function submitRedeem(numericAmount: number, idempotencyKey: string, confirmGroupSettlement: boolean) {
    if (!session || !voucher) return null;

    const res = await fetch("/api/business/pos/redeem", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({
        voucherId: voucher.id,
        amount: numericAmount,
        idempotencyKey,
        confirmGroupSettlement,
      }),
    });
    return res.json();
  }

  function applyRedeemSuccess(json: {
    newBalance: number;
    newStatus: string;
    totalBalance?: number;
    settlements?: { clientName: string; amount: number }[];
  }) {
    const settlementNote = json.settlements?.length
      ? ` (doplaceno: ${json.settlements.map((s) => `${s.clientName} ${s.amount} Kč`).join(", ")})`
      : "";
    setRedeemResult({ ok: true, message: `Uplatněno.${settlementNote}` });
    setVoucher((prev) =>
      prev
        ? { ...prev, balance: json.newBalance, status: json.newStatus, totalBalance: json.totalBalance ?? prev.totalBalance }
        : prev
    );
    setAmount("");
    setPendingIdempotencyKey(null);
  }

  if (!authLoading && !session) {
    return (
      <main className="min-h-screen px-5 py-10">
        <div className="mx-auto flex max-w-lg flex-col gap-6">
          <header className="border-b border-line pb-4">
            <h1 className="font-display text-lg font-bold tracking-tight">POS</h1>
          </header>
          <p className="font-mono text-sm text-ink-dim">
            Nejste přihlášeni —{" "}
            <Link href={`/app/login?next=${encodeURIComponent("/business/pos")}`} className="text-teal underline">
              přihlásit se
            </Link>
          </p>
        </div>
      </main>
    );
  }

  return (
    <BusinessShell title="POS">
      {authLoading || isOperator === undefined ? (
        <p className="font-mono text-sm text-ink-dim">Načítám…</p>
      ) : !isOperator ? (
        <div className="rounded-sm border border-dashed border-line-strong p-6 text-center text-sm text-ink-faint">
          Tento účet není napojený na žádného klienta.
        </div>
      ) : (
        <div className="flex max-w-sm flex-col gap-3.5">
          <form onSubmit={handleLookup} className="flex flex-col gap-2">
            <label className="text-[11.5px] text-ink-faint">Kód vouchru</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="např. CFL-8821"
                className="flex-1 rounded-sm border border-line-strong bg-panel px-3 py-2 text-sm text-ink"
              />
              <button
                type="submit"
                disabled={looking}
                className="rounded-sm bg-teal px-4 py-2 text-[13px] font-semibold text-[#04211B] disabled:opacity-50"
              >
                {looking ? "Hledám…" : "Najít"}
              </button>
            </div>
          </form>

          {lookupError && <p className="text-[11.5px] text-danger">{lookupError}</p>}

          {voucher && (
            <div
              className="flex flex-col gap-2 rounded-sm p-4"
              style={{
                border: "1px solid rgba(255,255,255,.12)",
                background: "linear-gradient(160deg, rgba(255,255,255,.09), rgba(255,255,255,.035))",
                backdropFilter: "blur(10px)",
              }}
            >
              <div className="flex items-center justify-between">
                <span className="text-[13.5px] font-semibold">{voucher.programName}</span>
                <span className="badge">{voucherStatusLabel(voucher.status)}</span>
              </div>

              {voucher.isMultiIssuer && (
                <p className="text-[11px] text-ink-faint">
                  Čerpá se z: <span className="text-ink">{voucher.clientName}</span>
                </p>
              )}

              <div className="font-display text-2xl font-bold text-teal">
                {formatCurrency(voucher.balance, voucher.currency)}
              </div>
              {voucher.isMultiIssuer && voucher.totalBalance !== undefined && (
                <p className="text-[11px] text-ink-faint">
                  Na kartě celkem: {formatCurrency(voucher.totalBalance, voucher.currency)}
                </p>
              )}
              <span className="font-mono text-[10px] text-ink-faint">{voucher.code}</span>

              <label className="mt-2 text-[11.5px] text-ink-faint">Částka k uplatnění</label>
              <input
                type="number"
                min={1}
                max={voucher.isMultiIssuer ? voucher.totalBalance : voucher.balance}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="rounded-sm border border-line-strong bg-panel px-3 py-2 text-center text-sm text-ink"
              />

              <Button onClick={handleRedeem} disabled={redeeming} className="mt-1">
                {redeeming ? "Zpracovávám…" : "Potvrdit uplatnění"}
              </Button>

              {groupSettlementOffer && (
                <div className="mt-1 flex flex-col gap-2 rounded-sm border border-line-strong bg-panel2 p-3">
                  <p className="text-[12px] text-ink">
                    U firmy <b>{voucher.clientName}</b> zbývá {formatCurrency(groupSettlementOffer.ownBalance, voucher.currency)},
                    chybí ještě {formatCurrency(groupSettlementOffer.shortfall, voucher.currency)}.
                  </p>
                  <p className="text-[11.5px] text-ink-dim">
                    Doplatit ze skupiny:{" "}
                    {groupSettlementOffer.drawPlan.map((d) => `${d.clientName} ${formatCurrency(d.amount, voucher.currency)}`).join(", ")}
                  </p>
                  <p className="text-[11px] text-ink-faint">
                    Jde o převod mezi spřízněnými osobami — mezi firmami vznikne evidovaný dluh.
                  </p>
                  <div className="flex gap-2">
                    <Button onClick={handleConfirmGroupSettlement} disabled={redeeming} className="flex-1">
                      {redeeming ? "Zpracovávám…" : "Doplatit ze skupiny"}
                    </Button>
                    <button
                      type="button"
                      onClick={() => {
                        setGroupSettlementOffer(null);
                        setPendingIdempotencyKey(null);
                      }}
                      className="rounded-sm border border-line-strong px-3 py-2 text-[12px] text-ink-dim"
                    >
                      Zrušit
                    </button>
                  </div>
                </div>
              )}

              {redeemResult && (
                <p className={`text-[11.5px] ${redeemResult.ok ? "text-positive" : "text-danger"}`}>
                  {redeemResult.message}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </BusinessShell>
  );
}
