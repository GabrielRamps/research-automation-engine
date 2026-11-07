#!/usr/bin/env tsx
/**
 * Encryption Verification Script
 * 
 * This script verifies that your API keys are properly encrypted
 * with AES-256-GCM (v2 format) and can be decrypted successfully.
 * 
 * Usage: tsx scripts/verify-encryption.ts
 */

import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

// Load environment variables FIRST (before importing encryption module)
const envPath = path.join(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
  console.log('✅ Loaded environment from .env.local\n');
}

// NOW import modules that depend on env vars
import { createClient } from '@supabase/supabase-js';
import { encrypt, decrypt } from '../lib/encryption';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

async function verifyEncryption() {
  console.log('🔐 Encryption Verification Tool');
  console.log('='.repeat(60));
  console.log('');

  // 1. Check encryption key
  const encryptionKey = process.env.ENCRYPTION_SECRET_KEY;
  if (!encryptionKey || encryptionKey.length < 32) {
    console.error('❌ ENCRYPTION_SECRET_KEY is missing or too short');
    console.error('   Must be at least 32 characters');
    process.exit(1);
  }
  console.log(`✅ ENCRYPTION_SECRET_KEY: ${encryptionKey.length} characters`);
  console.log('');

  // 2. Test encryption/decryption with sample data
  console.log('📝 Testing Encryption/Decryption...');
  const testKey = 'sk-ant-api03-test-key-1234567890-abcdefghijklmnopqrstuvwxyz';
  
  try {
    const encrypted = await encrypt(testKey);
    console.log(`   Encrypted format: ${encrypted.substring(0, 50)}...`);
    
    if (!encrypted.startsWith('v2:')) {
      console.error('   ❌ ERROR: Encrypted value does not start with "v2:"');
      console.error('   This means AES-256-GCM is NOT being used!');
      process.exit(1);
    }
    console.log('   ✅ Format: v2 (AES-256-GCM)');
    
    const decrypted = await decrypt(encrypted);
    if (decrypted === testKey) {
      console.log('   ✅ Encryption/Decryption: Working correctly');
    } else {
      console.error('   ❌ ERROR: Decrypted value does not match original');
      process.exit(1);
    }
  } catch (error: any) {
    console.error('   ❌ ERROR:', error.message);
    process.exit(1);
  }
  console.log('');

  // 3. Check user's API keys in database
  console.log('🔍 Checking Your API Keys in Database...');
  const { data: keys, error } = await supabase
    .from('user_api_keys')
    .select('*')
    .single();

  if (error || !keys) {
    console.error('   ❌ No API keys found in database');
    console.error('   Have you saved your API keys yet?');
    process.exit(1);
  }

  console.log(`   User ID: ${keys.user_id.substring(0, 8)}...`);
  console.log('');

  // Check each key
  const keyTypes = [
    { name: 'Claude', field: 'claude_api_key_encrypted', validated: keys.claude_validated },
    { name: 'Perplexity', field: 'perplexity_api_key_encrypted', validated: keys.perplexity_validated },
    { name: 'Gemini', field: 'gemini_api_key_encrypted', validated: keys.gemini_validated }
  ];

  let allKeysV2 = true;
  let allKeysDecrypt = true;

  for (const keyType of keyTypes) {
    const encryptedValue = (keys as any)[keyType.field];
    
    if (!encryptedValue) {
      console.log(`   ⚠️  ${keyType.name}: Not set`);
      continue;
    }

    // Check format
    const isV2 = encryptedValue.startsWith('v2:');
    const formatIcon = isV2 ? '✅' : '❌';
    const formatText = isV2 ? 'v2 (AES-256-GCM)' : 'legacy (XOR - WEAK)';
    
    console.log(`   ${formatIcon} ${keyType.name}:`);
    console.log(`      Format: ${formatText}`);
    console.log(`      Validated: ${keyType.validated ? '✅' : '⚠️  Not validated'}`);
    console.log(`      Length: ${encryptedValue.length} chars`);

    if (!isV2) {
      allKeysV2 = false;
    }

    // Try to decrypt
    try {
      const decrypted = await decrypt(encryptedValue);
      console.log(`      Decryption: ✅ Success`);
      console.log(`      Key starts with: ${decrypted.substring(0, 15)}...`);
      
      // Validate key format
      if (keyType.name === 'Claude' && !decrypted.startsWith('sk-ant-')) {
        console.log(`      ⚠️  Warning: Key doesn't match Claude format`);
      }
      if (keyType.name === 'Perplexity' && !decrypted.startsWith('pplx-')) {
        console.log(`      ⚠️  Warning: Key doesn't match Perplexity format`);
      }
      if (keyType.name === 'Gemini' && !decrypted.startsWith('AIza')) {
        console.log(`      ⚠️  Warning: Key doesn't match Gemini format`);
      }
    } catch (error: any) {
      console.log(`      ❌ Decryption: Failed - ${error.message}`);
      allKeysDecrypt = false;
    }
    
    console.log('');
  }

  // 4. Summary
  console.log('='.repeat(60));
  console.log('📊 Verification Summary');
  console.log('='.repeat(60));
  
  if (allKeysV2 && allKeysDecrypt) {
    console.log('');
    console.log('🎉 SUCCESS! Your encryption is working perfectly!');
    console.log('');
    console.log('✅ All keys use AES-256-GCM (v2 format)');
    console.log('✅ All keys can be decrypted successfully');
    console.log('✅ Encryption key is strong (32+ characters)');
    console.log('✅ Ready for production with enterprise-grade security');
    console.log('');
  } else {
    console.log('');
    if (!allKeysV2) {
      console.log('⚠️  WARNING: Some keys still use legacy XOR encryption');
      console.log('   Run: npm run migrate-encryption');
      console.log('');
    }
    if (!allKeysDecrypt) {
      console.log('❌ ERROR: Some keys failed to decrypt');
      console.log('   Check that ENCRYPTION_SECRET_KEY is correct');
      console.log('');
    }
  }

  // 5. Security recommendations
  console.log('🔒 Security Checklist:');
  console.log('   ' + (allKeysV2 ? '✅' : '❌') + ' AES-256-GCM encryption (v2 format)');
  console.log('   ' + (encryptionKey.length >= 32 ? '✅' : '❌') + ' Strong encryption key (32+ chars)');
  console.log('   ' + (allKeysDecrypt ? '✅' : '❌') + ' Keys decrypt successfully');
  console.log('   ' + (keys.claude_validated ? '✅' : '⚠️ ') + ' Claude key validated');
  console.log('   ' + (keys.perplexity_validated ? '✅' : '⚠️ ') + ' Perplexity key validated');
  console.log('   ' + (keys.gemini_validated ? '✅' : '⚠️ ') + ' Gemini key validated');
  console.log('');
}

// Run verification
verifyEncryption()
  .then(() => {
    console.log('✨ Verification complete!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 Verification failed:', error);
    process.exit(1);
  });

