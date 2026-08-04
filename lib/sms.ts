import { normalizePhone } from "@/lib/phone";

const TOKEN_URL = "https://app.gosms.eu/oauth/v2/token";
const MESSAGES_URL = "https://app.gosms.eu/api/v1/messages";

// Token platí 1h a smí se cachovat/opakovaně použít (GoSMS dokumentace).
// Modulová proměnná přežije jen v rámci teplé serverless instance — na
// Vercelu to tedy šetří volání jen občas, ne vždy, ale nikdy neškodí:
// při studeném startu se prostě vyžádá nový token.
let cachedToken: { value: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.value;
  }

  const clientId = process.env.GOSMS_CLIENT_ID;
  const clientSecret = process.env.GOSMS_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("GoSMS není nakonfigurované (chybí GOSMS_CLIENT_ID/GOSMS_CLIENT_SECRET).");
  }

  const url = new URL(TOKEN_URL);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("client_secret", clientSecret);
  url.searchParams.set("grant_type", "client_credentials");

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`GoSMS token požadavek selhal (${res.status}).`);
  }

  const json = await res.json();
  if (!json.access_token) {
    throw new Error("GoSMS token požadavek nevrátil access_token.");
  }

  // 60s rezerva, ať appka nepoužije token těsně před vypršením.
  cachedToken = { value: json.access_token, expiresAt: Date.now() + (json.expires_in - 60) * 1000 };
  return cachedToken.value;
}

export async function sendSms(phone: string, message: string): Promise<void> {
  const channel = process.env.GOSMS_CHANNEL;
  if (!channel) {
    throw new Error("GoSMS není nakonfigurované (chybí GOSMS_CHANNEL).");
  }

  const token = await getAccessToken();
  const recipient = normalizePhone(phone);

  const res = await fetch(MESSAGES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message,
      channel: Number(channel),
      recipients: recipient,
    }),
  });

  if (res.status !== 201) {
    const errorBody = await res.json().catch(() => null);
    const detail = errorBody?.message || errorBody?.error || JSON.stringify(errorBody);
    throw new Error(`Odeslání SMS se nezdařilo (${res.status})${detail ? `: ${detail}` : "."}`);
  }

  const json = await res.json();
  const invalid = json?.recipients?.invalid;
  if (Array.isArray(invalid) && invalid.length > 0) {
    throw new Error("GoSMS odmítl toto telefonní číslo jako neplatné.");
  }
}
