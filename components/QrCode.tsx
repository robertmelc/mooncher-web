"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";

type QrCodeProps = {
  value: string;
  size?: number;
};

// Obecná QR komponenta, ne vázaná na referral — generuje se v prohlížeči
// (appka je čistě client-komponentová, URL se skládá až z window.location,
// žádný nový endpoint/round-trip potřeba). Záměrně černá na bílém, ne v
// barvách appky — invertovaný/barevný QR na tmavém pozadí má výrazně horší
// reálnou spolehlivost skenování napříč telefony, i když appka je jinak
// celá tmavá. Quiet zone (bílý okraj) necháváme na knihovním výchozím
// nastavení — to je přesně to, co skenování nejvíc kazí, když se zmenší.
export function QrCode({ value, size = 176 }: QrCodeProps) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    QRCode.toDataURL(value, { width: size * 1.5, errorCorrectionLevel: "M" })
      .then((url) => {
        if (!cancelled) setDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setDataUrl(null);
      });

    return () => {
      cancelled = true;
    };
  }, [value, size]);

  if (!dataUrl) {
    return (
      <div
        className="flex items-center justify-center rounded-sm bg-white"
        style={{ width: size, height: size }}
      >
        <span className="font-mono text-[10px] text-void">Generuji…</span>
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={dataUrl}
      width={size}
      height={size}
      alt="QR kód pozvánky"
      className="rounded-sm bg-white p-2"
    />
  );
}
