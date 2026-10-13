const BACKUP_VERSION = 1;
const PBKDF2_ITERATIONS = 310_000;
const MIN_ITERATIONS = 100_000;
const MAX_ITERATIONS = 1_000_000;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const aad = encoder.encode("garaj-basikal-backup:v1");

function bytesToHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(value, expectedBytes) {
  if (typeof value !== "string" || !new RegExp(`^[0-9a-f]{${expectedBytes * 2}}$`, "i").test(value)) {
    throw new Error("Format fail sandaran tidak sah.");
  }
  return Uint8Array.from(value.match(/.{2}/g), (byte) => Number.parseInt(byte, 16));
}

async function deriveKey(password, salt, iterations) {
  const material = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function checkPassword(password) {
  if (typeof password !== "string" || password.length < 12 || password.length > 256) {
    throw new Error("Kata laluan sandaran mesti antara 12 hingga 256 aksara.");
  }
}

export async function encryptBackup(value, password) {
  checkPassword(password);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, PBKDF2_ITERATIONS);
  const plaintext = encoder.encode(JSON.stringify(value));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad }, key, plaintext);
  return {
    format: "garaj-basikal-encrypted-backup",
    version: BACKUP_VERSION,
    algorithm: "AES-256-GCM",
    kdf: "PBKDF2-SHA-256",
    iterations: PBKDF2_ITERATIONS,
    salt: bytesToHex(salt),
    iv: bytesToHex(iv),
    ciphertext: bytesToHex(new Uint8Array(ciphertext)),
  };
}

export async function decryptBackup(envelope, password) {
  checkPassword(password);
  if (!envelope || envelope.format !== "garaj-basikal-encrypted-backup" || envelope.version !== BACKUP_VERSION ||
    envelope.algorithm !== "AES-256-GCM" || envelope.kdf !== "PBKDF2-SHA-256" ||
    !Number.isSafeInteger(envelope.iterations) || envelope.iterations < MIN_ITERATIONS ||
    envelope.iterations > MAX_ITERATIONS || typeof envelope.ciphertext !== "string" ||
    envelope.ciphertext.length > 100_000_000 || envelope.ciphertext.length % 2 !== 0 ||
    !/^[0-9a-f]+$/i.test(envelope.ciphertext)) {
    throw new Error("Fail ini bukan sandaran Garaj Basikal yang disokong atau tidak disokong/rosak.");
  }
  const salt = hexToBytes(envelope.salt, 16);
  const iv = hexToBytes(envelope.iv, 12);
  const ciphertext = hexToBytes(envelope.ciphertext, envelope.ciphertext.length / 2);
  const key = await deriveKey(password, salt, envelope.iterations);
  try {
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: aad }, key, ciphertext);
    return JSON.parse(decoder.decode(plaintext));
  } catch {
    throw new Error("Kata laluan sandaran salah atau fail sandaran telah diubah.");
  }
}
