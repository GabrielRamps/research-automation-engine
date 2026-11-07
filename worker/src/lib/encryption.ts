// Encryption utilities for API keys (Worker - Synchronous version)
// Uses AES-256-GCM encryption with PBKDF2 key derivation
// Backward compatible with legacy XOR encryption

import crypto from 'crypto';

/**
 * Thrown when stored ciphertext cannot be decrypted with the current
 * ENCRYPTION_SECRET_KEY/ENCRYPTION_SALT. Almost always means the user's
 * keys were saved before a security rotation and need to be re-entered.
 *
 * Subclasses Error with the same message string ("Failed to decrypt data")
 * so existing string-based catch logic continues to work.
 */
export class DecryptionError extends Error {
  constructor(cause?: unknown) {
    super('Failed to decrypt data');
    this.name = 'DecryptionError';
    if (cause instanceof Error) {
      (this as Error & { cause?: unknown }).cause = cause;
    }
  }
}

const ENCRYPTION_KEY = process.env.ENCRYPTION_SECRET_KEY || '';
const ENCRYPTION_SALT = process.env.ENCRYPTION_SALT || '';
const ALGORITHM = 'aes-256-gcm';

if (!ENCRYPTION_KEY) {
  console.warn('WARNING: ENCRYPTION_SECRET_KEY not set. API keys will not be encrypted properly.');
}

if (!ENCRYPTION_SALT) {
  console.warn('WARNING: ENCRYPTION_SALT not set. API keys will not be encrypted properly.');
}

/**
 * Derive encryption key using PBKDF2
 */
function deriveKey(): Buffer {
  if (!ENCRYPTION_KEY || ENCRYPTION_KEY.length < 32) {
    throw new Error('ENCRYPTION_SECRET_KEY must be at least 32 characters');
  }
  if (!ENCRYPTION_SALT || ENCRYPTION_SALT.length < 16) {
    throw new Error('ENCRYPTION_SALT must be at least 16 characters');
  }
  return crypto.pbkdf2Sync(ENCRYPTION_KEY, ENCRYPTION_SALT, 100000, 32, 'sha256');
}

/**
 * New AES-256-GCM encryption (format: "v2:iv:authTag:data")
 * @param text - The text to encrypt
 * @returns Base64 encoded encrypted data with version prefix
 */
export function encrypt(text: string): string {
  if (!text) return '';
  
  try {
    const key = deriveKey();
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    
    let encrypted = cipher.update(text, 'utf8', 'base64');
    encrypted += cipher.final('base64');
    const authTag = cipher.getAuthTag();
    
    // Prefix with 'v2:' to identify new format
    return `v2:${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted}`;
  } catch (error) {
    console.error('Encryption error:', error);
    throw new Error('Failed to encrypt data');
  }
}

/**
 * Legacy XOR decryption (for existing data)
 * @param encryptedText - Base64 encoded XOR encrypted data
 * @returns Decrypted text
 */
function legacyDecrypt(encryptedText: string): string {
  const encrypted = Buffer.from(encryptedText, 'base64');
  const encoder = new TextEncoder();
  const keyData = encoder.encode(ENCRYPTION_KEY.padEnd(32, '0').substring(0, 32));
  const decrypted = new Uint8Array(encrypted.length);
  
  for (let i = 0; i < encrypted.length; i++) {
    decrypted[i] = encrypted[i] ^ keyData[i % keyData.length];
  }
  
  return new TextDecoder().decode(decrypted);
}

/**
 * New AES-256-GCM decryption
 * @param encryptedText - Encrypted text with v2: prefix
 * @returns Decrypted text
 */
function aesDecrypt(encryptedText: string): string {
  const parts = encryptedText.substring(3).split(':'); // Remove 'v2:' prefix
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted format');
  }
  
  const [ivBase64, authTagBase64, encrypted] = parts;
  const key = deriveKey();
  const iv = Buffer.from(ivBase64, 'base64');
  const authTag = Buffer.from(authTagBase64, 'base64');
  
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  
  let decrypted = decipher.update(encrypted, 'base64', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

/**
 * Auto-detect and decrypt (backward compatible)
 * @param encryptedText - Base64 encoded encrypted data (v2 or legacy format)
 * @returns Decrypted text
 */
export function decrypt(encryptedText: string): string {
  if (!encryptedText) return '';
  
  try {
    // Detect format
    if (encryptedText.startsWith('v2:')) {
      return aesDecrypt(encryptedText);
    } else {
      // Legacy XOR format
      return legacyDecrypt(encryptedText);
    }
  } catch (error) {
    console.error('Decryption error:', error);
    throw new DecryptionError(error);
  }
}
