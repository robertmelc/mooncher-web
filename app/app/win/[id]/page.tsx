"use client";

import { useEffect, useState } from "react";
import { formatCurrency } from "@/lib/format";
import { supabase } from "@/lib/supabase/client";
import styles from "./WinningTicket.module.css";

type Ticket = {
  listNumber: string;
  resultNumber: string;
  place: number | null;
  prizeAmount: number;
  currency: string;
  amountIsNet: boolean;
  taxWithheld: number | null;
  claimDeadline: string;
  clientName: string;
  drawDate: string;
  seed: string;
  resultHash: string;
  phoneLastFour: string;
  status: "voided" | "claimed" | "expired" | "pending";
};

function truncateMiddle(value: string): string {
  if (value.length <= 10) return value;
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

export default function WinningTicketPage({ params }: { params: { id: string } }) {
  const [ticket, setTicket] = useState<Ticket | null | undefined>(undefined);

  const [codeSent, setCodeSent] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);

  const [code, setCode] = useState("");
  const [fullName, setFullName] = useState("");
  const [bankAccount, setBankAccount] = useState("");
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    async function load() {
      const res = await fetch(`/api/win/${params.id}`);
      const json = await res.json();
      setTicket(json.ok ? json.ticket : null);
    }
    load();
  }, [params.id]);

  async function handleSendCode() {
    setSendingCode(true);
    setCodeError(null);

    const res = await fetch(`/api/win/${params.id}/send-code`, { method: "POST" });
    const json = await res.json();
    setSendingCode(false);

    if (!json.ok) {
      setCodeError(json.error ?? "Odeslání se nezdařilo.");
      return;
    }
    setCodeSent(true);
  }

  async function handleSubmit() {
    if (!code.trim() || !fullName.trim() || !bankAccount.trim() || !phone.trim()) {
      setSubmitError("Vyplňte prosím všechna pole.");
      return;
    }
    if (bankAccount.replace(/\D/g, "").length < 8) {
      setSubmitError("Zkontrolujte prosím číslo účtu.");
      return;
    }

    setSubmitting(true);
    setSubmitError(null);

    // Přihlášení je tu čistě volitelné (viz konverzace) — appka se nikoho
    // neptá, jen pošle token dál, POKUD zrovna nějaký má. Bez session se
    // pošle přesně stejný request jako dřív, guest cesta se nemění.
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;

    const res = await fetch(`/api/win/${params.id}/claim`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify({ code: code.trim(), fullName: fullName.trim(), bankAccount: bankAccount.trim(), phone: phone.trim() }),
    });
    const json = await res.json();
    setSubmitting(false);

    if (!json.ok) {
      setSubmitError(json.error ?? "Odeslání se nezdařilo.");
      return;
    }
    setDone(true);
  }

  if (ticket === undefined) {
    return (
      <div className={styles.page}>
        <div className={styles.stage}>
          <p className={styles.foot}>Načítám…</p>
        </div>
      </div>
    );
  }

  if (ticket === null) {
    return (
      <div className={styles.page}>
        <div className={styles.stage}>
          <div className={styles.notice}>
            <b>Výherní list nenalezen</b>
            <p>Zkontrolujte prosím odkaz, který jste dostali.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.stage}>
        <div className={styles.list}>
          <div className={styles.top}>
            <div>
              <div className={styles.eyebrow}>Výherní list</div>
              <h1 className={styles.h1}>Gratulujeme!</h1>
              <div className={styles.sub}>{ticket.clientName}</div>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className={styles.logo} src="/icon-192.png" alt="Mooncher" />
          </div>

          <div className={styles.amount}>
            <div className={styles.lab}>Výhra</div>
            <b>{formatCurrency(ticket.prizeAmount, ticket.currency)}</b>
            <small>
              {ticket.amountIsNet ? "vyplácí se převodem na váš účet" : "hrubá částka, daň se strhne při výplatě"}
              {ticket.taxWithheld ? ` · sraženo ${formatCurrency(ticket.taxWithheld, ticket.currency)}` : ""}
            </small>
          </div>

          <div className={styles.warn}>
            <b>Tímto listem nelze platit</b>
            Není to voucher se zůstatkem. Nemá platební kód a u pokladny ho nepoužijete — slouží jen k tomu, abyste
            si řekli o výplatu výhry.
          </div>

          <div className={styles.rows}>
            <div className={styles.r}>
              <span>Číslo listu</span>
              <b>{ticket.listNumber}</b>
            </div>
            <div className={styles.r}>
              <span>Vylosovaný los</span>
              <b>
                {ticket.resultNumber}
                {ticket.place ? ` (${ticket.place}. místo)` : ""}
              </b>
            </div>
            <div className={styles.r}>
              <span>Datum losování</span>
              <b>{new Date(ticket.drawDate).toLocaleDateString("cs-CZ")}</b>
            </div>
            <div className={styles.r}>
              <span>Kontrolní seed</span>
              <b>{truncateMiddle(ticket.seed)}</b>
            </div>
            <div className={styles.r}>
              <span>Nárok uplatnit do</span>
              <b>{new Date(ticket.claimDeadline).toLocaleDateString("cs-CZ")}</b>
            </div>
          </div>
        </div>

        {ticket.status === "voided" ? (
          <div className={styles.notice}>
            <b>Tento list byl zneplatněn</b>
            <p>Pro víc informací se ozvěte tomu, kdo vám ho vydal.</p>
          </div>
        ) : ticket.status === "expired" ? (
          <div className={styles.notice}>
            <b>Lhůta pro uplatnění vypršela</b>
            <p>Nárok na výhru byl zrušen.</p>
          </div>
        ) : ticket.status === "claimed" || done ? (
          <div className={styles.done}>
            <b>Přijato k výplatě</b>
            <p>Výhru pošleme na uvedený účet, obvykle do čtrnácti dnů.</p>
          </div>
        ) : !codeSent ? (
          <div className={styles.form}>
            <h2>Ověření telefonu</h2>
            <p className={styles.formSub}>
              Než zadáte účet, ověříme, že jste to skutečně vy — pošleme SMS kód na telefon, na který byl los
              registrovaný (končí {ticket.phoneLastFour}).
            </p>
            <button className={styles.button} onClick={handleSendCode} disabled={sendingCode}>
              {sendingCode ? "Odesílám…" : "Poslat ověřovací SMS"}
            </button>
            {codeError && <p className={styles.errorText}>{codeError}</p>}
          </div>
        ) : (
          <div className={styles.form}>
            <h2>Kam máme výhru poslat</h2>
            <p className={styles.formSub}>
              Zadejte ověřovací kód z SMS a účet, na který výhru převedeme. Výplatu provádí {ticket.clientName}
              přímo ze svého účtu, obvykle do čtrnácti dnů.
            </p>
            <label className={styles.label}>Ověřovací kód z SMS</label>
            <input
              className={styles.input}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="123456"
              inputMode="numeric"
            />
            <label className={styles.label}>Jméno a příjmení</label>
            <input
              className={styles.input}
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Jan Novák"
              autoComplete="name"
            />
            <label className={styles.label}>Číslo účtu</label>
            <input
              className={styles.input}
              value={bankAccount}
              onChange={(e) => setBankAccount(e.target.value)}
              placeholder="123456789/0100"
              inputMode="numeric"
            />
            <label className={styles.label}>Telefon</label>
            <input
              className={styles.input}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+420 777 123 456"
              type="tel"
              autoComplete="tel"
            />
            <button className={styles.button} onClick={handleSubmit} disabled={submitting}>
              {submitting ? "Odesílám…" : "Odeslat k výplatě"}
            </button>
            {submitError && <p className={styles.errorText}>{submitError}</p>}
            <p className={styles.gdpr}>
              Údaje použijeme jen k výplatě výhry a k jejímu doložení. U výher nad 50 000 Kč srážíme podle zákona 15
              % daň.
            </p>
          </div>
        )}

        <p className={styles.foot}>ROOMS MANAGEMENT s.r.o.</p>
      </div>
    </div>
  );
}
