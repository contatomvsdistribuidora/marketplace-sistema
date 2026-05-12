import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

let cachedKey: Buffer | null = null;
function getKey(): Buffer {
  if (cachedKey) return cachedKey;

  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "ENCRYPTION_KEY não definida. Adicione no .env (local) ou Railway Variables (produção). " +
      "Gere com: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
    );
  }

  if (raw.length !== 64) {
    throw new Error(`ENCRYPTION_KEY deve ter 64 caracteres hex (32 bytes). Tem ${raw.length}.`);
  }

  cachedKey = Buffer.from(raw, "hex");
  if (cachedKey.length !== 32) {
    throw new Error("ENCRYPTION_KEY inválida — após decode hex, deveria ter 32 bytes.");
  }

  return cachedKey;
}

export function encrypt(plaintext: string): string {
  if (!plaintext || plaintext.length === 0) {
    throw new Error("encrypt: texto vazio");
  }

  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

export function decrypt(payload: string): string {
  if (!payload || !payload.includes(":")) {
    throw new Error("decrypt: payload inválido");
  }

  const parts = payload.split(":");
  if (parts.length !== 3) {
    throw new Error("decrypt: formato esperado 'iv:authTag:ciphertext'");
  }

  const [ivHex, authTagHex, ciphertextHex] = parts;

  const key = getKey();
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const ciphertext = Buffer.from(ciphertextHex, "hex");

  if (iv.length !== IV_LENGTH) {
    throw new Error(`decrypt: IV deve ter ${IV_LENGTH} bytes, tem ${iv.length}`);
  }
  if (authTag.length !== AUTH_TAG_LENGTH) {
    throw new Error(`decrypt: authTag deve ter ${AUTH_TAG_LENGTH} bytes, tem ${authTag.length}`);
  }

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}

export function selfTest(): { ok: boolean; error?: string } {
  try {
    const original = "test-string-" + Date.now();
    const encrypted = encrypt(original);
    const decrypted = decrypt(encrypted);

    if (decrypted !== original) {
      return { ok: false, error: "round-trip falhou: decrypted !== original" };
    }

    if (!encrypted.includes(":") || encrypted.split(":").length !== 3) {
      return { ok: false, error: "formato de output inválido" };
    }

    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "erro desconhecido" };
  }
}
