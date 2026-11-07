#!/usr/bin/env tsx
/**
 * One-time script to rotate encryption keys.
 * Decrypts all stored API keys using OLD credentials, re-encrypts with NEW credentials.
 *
 * Usage:
 *   OLD_ENCRYPTION_SECRET_KEY=<old> OLD_ENCRYPTION_SALT=<old> \
 *   NEW_ENCRYPTION_SECRET_KEY=<new> NEW_ENCRYPTION_SALT=<new> \
 *   npx tsx scripts/rekey-encryption.ts
 *
 * Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from .env.local or environment.
 */

import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

const envPath = path.join(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
  console.log('Loaded environment from .env.local\n');
}

const OLD_KEY = process.env.OLD_ENCRYPTION_SECRET_KEY || '';
const OLD_SALT = process.env.OLD_ENCRYPTION_SALT || '';
const NEW_KEY = process.env.NEW_ENCRYPTION_SECRET_KEY || '';
const NEW_SALT = process.env.NEW_ENCRYPTION_SALT || '';

if (!OLD_KEY || OLD_KEY.length < 32) { console.error('OLD_ENCRYPTION_SECRET_KEY missing or too short'); process.exit(1); }
if (!OLD_SALT || OLD_SALT.length < 16) { console.error('OLD_ENCRYPTION_SALT missing or too short'); process.exit(1); }
if (!NEW_KEY || NEW_KEY.length < 32) { console.error('NEW_ENCRYPTION_SECRET_KEY missing or too short'); process.exit(1); }
if (!NEW_SALT || NEW_SALT.length < 16) { console.error('NEW_ENCRYPTION_SALT missing or too short'); process.exit(1); }
if (!process.env.NEXT_PUBLIC_SUPABASE_URL) { console.error('NEXT_PUBLIC_SUPABASE_URL missing'); process.exit(1); }
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) { console.error('SUPABASE_SERVICE_ROLE_KEY missing'); process.exit(1); }

const ALGORITHM = 'aes-256-gcm';

function deriveKey(secret: string, salt: string): Buffer {
  return crypto.pbkdf2Sync(secret, salt, 100000, 32, 'sha256');
}

function aesDecrypt(encryptedText: string, secret: string, salt: string): string {
  const parts = encryptedText.substring(3).split(':');
  if (parts.length !== 3) throw new Error('Invalid v2 format');
  const [ivBase64, authTagBase64, encrypted] = parts;
  const key = deriveKey(secret, salt);
  const iv = Buffer.from(ivBase64, 'base64');
  const authTag = Buffer.from(authTagBase64, 'base64');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encrypted, 'base64', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

function legacyDecrypt(encryptedText: string, secret: string): string {
  const encrypted = Buffer.from(encryptedText, 'base64');
  const keyData = Buffer.from(secret.padEnd(32, '0').substring(0, 32));
  const decrypted = new Uint8Array(encrypted.length);
  for (let i = 0; i < encrypted.length; i++) {
    decrypted[i] = encrypted[i] ^ keyData[i % keyData.length];
  }
  return Buffer.from(decrypted).toString('utf8');
}

function decrypt(encryptedText: string): string {
  if (!encryptedText) return '';
  if (encryptedText.startsWith('v2:')) return aesDecrypt(encryptedText, OLD_KEY, OLD_SALT);
  return legacyDecrypt(encryptedText, OLD_KEY);
}

function encrypt(text: string): string {
  if (!text) return '';
  const key = deriveKey(NEW_KEY, NEW_SALT);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(text, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  const authTag = cipher.getAuthTag();
  return `v2:${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted}`;
}

// True if the value already decrypts with the NEW credentials (e.g. from a
// previous partial run), so re-running the script is safe.
function isOnNewKey(encryptedText: string): boolean {
  if (!encryptedText.startsWith('v2:')) return false;
  try {
    aesDecrypt(encryptedText, NEW_KEY, NEW_SALT);
    return true;
  } catch {
    return false;
  }
}

// All encrypted columns in user_api_keys (must match what app/api/keys/save writes)
const ENCRYPTED_COLUMNS = [
  'claude_api_key_encrypted',
  'tavily_api_key_encrypted',
  'dataforseo_login_encrypted',
  'dataforseo_password_encrypted',
  'perplexity_api_key_encrypted',
  'gemini_api_key_encrypted',
];

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  console.log('Fetching all user API keys...');
  const { data: users, error } = await supabase.from('user_api_keys').select('*');
  if (error) { console.error('Failed to fetch:', error); process.exit(1); }
  if (!users?.length) { console.log('No keys found. Nothing to do.'); return; }

  console.log(`Found ${users.length} user record(s)\n`);

  let totalRekeyed = 0;
  let totalErrors = 0;

  for (const user of users) {
    const updates: Record<string, string> = {};
    let hasUpdates = false;

    for (const col of ENCRYPTED_COLUMNS) {
      const value = user[col];
      if (!value) continue;
      if (isOnNewKey(value)) {
        console.log(`  Skipped ${col} for user ${user.user_id.substring(0, 8)}... (already on new key)`);
        continue;
      }

      try {
        const plaintext = decrypt(value);
        updates[col] = encrypt(plaintext);
        hasUpdates = true;
        console.log(`  Re-keyed ${col} for user ${user.user_id.substring(0, 8)}...`);
      } catch (err: any) {
        console.error(`  ERROR on ${col} for user ${user.user_id.substring(0, 8)}...: ${err.message}`);
        totalErrors++;
      }
    }

    if (hasUpdates) {
      const { error: updateError } = await supabase
        .from('user_api_keys')
        .update(updates)
        .eq('user_id', user.user_id);

      if (updateError) {
        console.error(`  DB update failed for ${user.user_id.substring(0, 8)}...: ${updateError.message}`);
        totalErrors++;
      } else {
        totalRekeyed++;
        console.log(`  Saved to DB\n`);
      }
    }
  }

  console.log('='.repeat(50));
  console.log(`Users re-keyed: ${totalRekeyed}`);
  console.log(`Errors: ${totalErrors}`);

  if (totalErrors > 0) {
    console.error('\nSome keys failed. Do NOT update env vars yet — fix errors first.');
    process.exit(1);
  } else {
    console.log('\nAll keys re-encrypted successfully.');
    console.log('Now update ENCRYPTION_SECRET_KEY and ENCRYPTION_SALT in Vercel + Railway and redeploy.');
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
