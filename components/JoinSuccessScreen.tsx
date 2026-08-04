"use client";

import { useState } from "react";

type JoinSuccessScreenProps = {
  onContinue: () => void;
};

// Vlastní, od zbytku appky záměrně odlišená paleta (fialová/lavender) —
// jednorázový uvítací moment po dokončení referral joinu, ne součást
// běžného appkového chrome. Obsah dodal Robert jako hotovou HTML/CSS
// šablonu; překlopeno do Reactu jen s tabs jako state místo vanilla JS
// (tady na rozdíl od zrušeného e-mailového plánu JS reálně běží — je to
// stránka appky v prohlížeči, ne e-mail).
const palette = {
  "--bg-0": "#0d0a1a",
  "--bg-1": "#1a1530",
  "--panel": "rgba(255,255,255,0.05)",
  "--panel-strong": "rgba(255,255,255,0.08)",
  "--line": "rgba(255,255,255,0.14)",
  "--line-dash": "rgba(167,139,250,0.35)",
  "--lavender": "#A78BFA",
  "--violet": "#C084FC",
  "--ink": "#ffffff",
  "--ink-dim": "rgba(255,255,255,0.68)",
  "--ink-faint": "rgba(255,255,255,0.42)",
} as React.CSSProperties;

const STEPS = [
  { title: "Zadej svůj e-mail", body: "Žádné heslo. Napiš e-mail a pošleme ti odkaz na přihlášení." },
  { title: "Klikni na odkaz v e-mailu", body: "Otevře se ti appka rovnou v prohlížeči, přihlášený/á jako ty." },
  { title: "Dostaneš vlastní voucher", body: "Objeví se ti v seznamu, zatím s nulovou hodnotou — tu si kdykoliv dobiješ." },
  {
    title: "Pozvi dál",
    body: "Ve svém voucheru najdeš vlastní QR kód. Kým dál pozveš, tím rychleji postoupíš na Ambassadora nebo Helpera.",
  },
];

const IOS_STEPS = [
  <>Appku otevři v <b>Safari</b> (ne v appce Gmail/Mail — odkaz otevři v prohlížeči).</>,
  <>Ťukni na ikonku <b>Sdílet</b> dole uprostřed obrazovky.</>,
  <>V nabídce najdi a ťukni na <b>Přidat na plochu</b>.</>,
  <>Potvrď tlačítkem <b>Přidat</b> vpravo nahoře. Hotovo — ikonka je na ploše.</>,
];

const ANDROID_STEPS = [
  <>Appku otevři v <b>Chromu</b>.</>,
  <>Ťukni na nabídku ⋮ (tři tečky) vpravo nahoře.</>,
  <>Vyber <b>Přidat na plochu</b> nebo <b>Nainstalovat appku</b> (podle verze Chromu).</>,
  <>Potvrď — ikonka se objeví na ploše jako běžná appka.</>,
];

export function JoinSuccessScreen({ onContinue }: JoinSuccessScreenProps) {
  const [platform, setPlatform] = useState<"ios" | "android">("ios");
  const steps = platform === "ios" ? IOS_STEPS : ANDROID_STEPS;

  return (
    <div
      style={{
        ...palette,
        background:
          "radial-gradient(circle at 85% -10%, rgba(167,139,250,0.16), transparent 55%), linear-gradient(165deg, var(--bg-1), var(--bg-0) 65%)",
        color: "var(--ink)",
        minHeight: "100vh",
      }}
      className="font-body"
    >
      <div className="mx-auto max-w-[480px] px-5 pb-16">
        <div className="pt-14 pb-10 text-center">
          <div
            className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-2xl font-display text-2xl font-extrabold"
            style={{ background: "linear-gradient(160deg, var(--violet), var(--lavender))" }}
          >
            B
          </div>
          <div
            className="mb-2.5 text-[12px] font-bold uppercase tracking-[0.14em]"
            style={{ color: "var(--lavender)" }}
          >
            Pozvánka přijata
          </div>
          <h1 className="mb-3.5 font-display text-[32px] font-extrabold leading-[1.15] tracking-tight">
            Vítej v klubu <span style={{ color: "var(--violet)" }}>bakaláři.app</span>
          </h1>
          <p className="mx-auto max-w-[340px] text-[15px]" style={{ color: "var(--ink-dim)" }}>
            Někdo z tvého okolí tě právě přizval do Příběhů, které pomáhají. Za pár kroků máš vlastní voucher.
          </p>
        </div>

        <div
          className="mb-5 font-mono text-[11px] font-bold uppercase tracking-[0.14em]"
          style={{ color: "var(--ink-faint)" }}
        >
          Co tě čeká
        </div>
        <div className="mb-14 mt-3">
          {STEPS.map((step, i) => (
            <div key={step.title} className="relative flex gap-4 pb-7 last:pb-0">
              {i < STEPS.length - 1 && (
                <div
                  className="absolute bottom-1 left-[17px] top-10 w-px"
                  style={{
                    background:
                      "repeating-linear-gradient(to bottom, var(--line-dash) 0 4px, transparent 4px 9px)",
                  }}
                />
              )}
              <div
                className="z-10 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[10px] font-display text-[15px] font-extrabold"
                style={{ background: "var(--panel-strong)", border: "1px solid var(--line)", color: "var(--violet)" }}
              >
                {i + 1}
              </div>
              <div>
                <h3 className="mb-1 font-display text-[16px] font-semibold">{step.title}</h3>
                <p className="text-[14px] leading-[1.5]" style={{ color: "var(--ink-dim)" }}>
                  {step.body}
                </p>
              </div>
            </div>
          ))}
        </div>

        <div className="mb-6">
          <h2 className="mb-2 font-display text-[22px] font-extrabold">Přidej si appku na plochu</h2>
          <p className="text-[14px]" style={{ color: "var(--ink-dim)" }}>
            Nemusíš nic stahovat z obchodu s appkami — appka se přidá jako ikonka přímo z prohlížeče, během pár
            vteřin.
          </p>
        </div>

        <div className="mb-5 flex gap-2 rounded-xl p-1" style={{ background: "var(--panel)" }}>
          {(["ios", "android"] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPlatform(p)}
              className="flex-1 rounded-[9px] py-2.5 text-center text-[13px] font-bold"
              style={
                platform === p
                  ? { background: "var(--panel-strong)", color: "var(--ink)" }
                  : { color: "var(--ink-faint)" }
              }
            >
              {p === "ios" ? "iPhone" : "Android"}
            </button>
          ))}
        </div>

        <div>
          {steps.map((txt, i) => (
            <div
              key={i}
              className="mb-3 flex items-start gap-3.5 rounded-2xl p-4"
              style={{ background: "var(--panel)", border: "1px solid var(--line)" }}
            >
              <div
                className="flex h-[26px] w-[26px] flex-shrink-0 items-center justify-center rounded-lg font-display text-[13px] font-extrabold"
                style={{ background: "rgba(167,139,250,0.18)", color: "var(--violet)" }}
              >
                {i + 1}
              </div>
              <div className="pt-0.5 text-[14px]" style={{ color: "var(--ink-dim)" }}>
                {txt}
              </div>
            </div>
          ))}
        </div>

        <div
          className="mt-10 rounded-2xl p-7 text-center"
          style={{ background: "var(--panel)", border: "1px solid var(--line)" }}
        >
          <p className="mb-1.5 font-display text-[16px] font-bold">Zaseknul/a ses někde?</p>
          <p className="text-[13px]" style={{ color: "var(--ink-faint)" }}>
            Ozvi se tomu, kdo tě pozval — rád/a ti to ukáže naživo.
          </p>
        </div>

        <button
          type="button"
          onClick={onContinue}
          className="mt-8 w-full rounded-xl py-3.5 text-center text-[14px] font-bold"
          style={{ background: "linear-gradient(160deg, var(--violet), var(--lavender))", color: "var(--bg-0)" }}
        >
          Pokračovat do appky
        </button>

        <div className="mt-8 flex items-center justify-center gap-2 opacity-60">
          <div className="h-[18px] w-[18px] rounded-[5px]" style={{ background: "var(--violet)" }} />
          <span className="text-[12px]" style={{ color: "var(--ink-faint)" }}>
            bakaláři.app · příběhy, které pomáhají
          </span>
        </div>
      </div>
    </div>
  );
}
