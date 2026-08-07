"use client";

import { useState } from "react";
import styles from "./[id]/WinningTicket.module.css";

// Vstupní bod pro "nedorazila mi výhra" — telefon je jediný vstup, appka
// nikdy nepotvrdí ani nevyvrátí, jestli k němu výhra existuje (viz
// konverzace k /api/win/find). Sem se dostane, kdo ztratil/nedostal
// původní SMS s odkazem na svůj konkrétní /app/win/[id].
export default function FindWinningTicketPage() {
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (!phone.trim()) {
      setError("Zadejte prosím telefonní číslo.");
      return;
    }

    setSubmitting(true);
    setError(null);

    const res = await fetch("/api/win/find", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: phone.trim() }),
    });
    const json = await res.json();
    setSubmitting(false);

    if (!json.ok) {
      setError(json.error ?? "Odeslání se nezdařilo.");
      return;
    }
    setResult(json.message);
  }

  return (
    <div className={styles.page}>
      <div className={styles.stage}>
        <div className={styles.form}>
          <h2>Nedorazila mi výhra</h2>
          <p className={styles.formSub}>
            Zadejte telefonní číslo, na které měl přijít odkaz na výherní list. Pokud k němu výhra existuje,
            pošleme odkaz znovu SMS.
          </p>
          {result ? (
            <div className={styles.done}>
              <b>Odesláno</b>
              <p>{result}</p>
            </div>
          ) : (
            <>
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
                {submitting ? "Odesílám…" : "Poslat odkaz znovu"}
              </button>
              {error && <p className={styles.errorText}>{error}</p>}
            </>
          )}
        </div>
        <p className={styles.foot}>ROOMS MANAGEMENT s.r.o.</p>
      </div>
    </div>
  );
}
