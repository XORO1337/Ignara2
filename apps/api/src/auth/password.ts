import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const SCRYPT_PREFIX = "scrypt";
const KEY_LENGTH = 64;

export function hashPassword(plainTextPassword: string): string {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(plainTextPassword, salt, KEY_LENGTH).toString("hex");
  return `${SCRYPT_PREFIX}$${salt}$${derived}`;
}

function verifyHashedPassword(storedPassword: string, inputPassword: string): boolean {
  const [prefix, salt, expectedHex] = storedPassword.split("$");
  if (prefix !== SCRYPT_PREFIX || !salt || !expectedHex) {
    return false;
  }

  const inputHex = scryptSync(inputPassword, salt, KEY_LENGTH).toString("hex");
  const expectedBuffer = Buffer.from(expectedHex, "hex");
  const inputBuffer = Buffer.from(inputHex, "hex");

  if (expectedBuffer.length !== inputBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, inputBuffer);
}

export function verifyPassword(storedPassword: string, inputPassword: string): boolean {
  if (storedPassword.startsWith(`${SCRYPT_PREFIX}$`)) {
    return verifyHashedPassword(storedPassword, inputPassword);
  }

  // Legacy support for existing seeded rows before hashing was introduced.
  return storedPassword === inputPassword;
}

export function needsPasswordUpgrade(storedPassword: string): boolean {
  return !storedPassword.startsWith(`${SCRYPT_PREFIX}$`);
}
