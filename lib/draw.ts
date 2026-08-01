import { createHash, randomBytes } from "crypto";

export type DrawResult = {
  seed: string;
  seedSource: "admin_provided" | "system_generated";
  resultHash: string;
  resultNumber: number;
};

// Provably-fair losování: SHA-256(seed:min:max) reduced modulo rozsahu.
// Kdokoliv se seedem a rozsahem si přepočítá stejné číslo bez nutnosti
// věřit appce — žádný skrytý klíč, jen veřejný hash nad veřejnými vstupy.
export function runDraw(min: number, max: number, providedSeed: string | undefined): DrawResult {
  const seedSource: DrawResult["seedSource"] = providedSeed ? "admin_provided" : "system_generated";
  const seed = providedSeed || randomBytes(32).toString("hex");

  const input = `${seed}:${min}:${max}`;
  const resultHash = createHash("sha256").update(input).digest("hex");

  const rangeSize = BigInt(max - min + 1);
  const value = BigInt("0x" + resultHash) % rangeSize;
  const resultNumber = min + Number(value);

  return { seed, seedSource, resultHash, resultNumber };
}
