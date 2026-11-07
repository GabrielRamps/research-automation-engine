#!/usr/bin/env tsx
/**
 * Migration script to re-encrypt API keys from legacy XOR to AES-256-GCM
 * 
 * Usage: tsx scripts/migrate-encryption.ts
 * 
 * This script:
 * 1. Fetches all user API keys from database
 * 2. Decrypts keys using legacy XOR format
 * 3. Re-encrypts using new AES-256-GCM format (v2:)
 * 4. Updates database with new encrypted values
 * 
 * Safe to run multiple times - skips already migrated keys
 */

import { createClient } from '@supabase/supabase-js';
import { encrypt, decrypt } from '../lib/encryption';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

// Load environment variables from .env.local if it exists
const envPath = path.join(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
  console.log('✅ Loaded environment from .env.local\n');
} else {
  console.log('⚠️  No .env.local found, using system environment variables\n');
}

// Validate required environment variables
if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
  console.error('❌ NEXT_PUBLIC_SUPABASE_URL is required');
  process.exit(1);
}

if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY is required');
  process.exit(1);
}

if (!process.env.ENCRYPTION_SECRET_KEY || process.env.ENCRYPTION_SECRET_KEY.length < 32) {
  console.error('❌ ENCRYPTION_SECRET_KEY must be at least 32 characters');
  console.error('   Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"');
  process.exit(1);
}

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

interface KeyMigrationResult {
  userId: string;
  migratedKeys: string[];
  errors: string[];
}

async function migrateKeys(): Promise<void> {
  console.log('🔄 Starting API key encryption migration...\n');
  
  // Fetch all users with API keys
  const { data: users, error } = await supabase
    .from('user_api_keys')
    .select('*');
  
  if (error) {
    console.error('❌ Failed to fetch user keys:', error);
    throw error;
  }
  
  if (!users || users.length === 0) {
    console.log('✅ No users found with API keys. Nothing to migrate.');
    return;
  }
  
  console.log(`📊 Found ${users.length} user(s) with API keys\n`);
  
  const results: KeyMigrationResult[] = [];
  let totalMigrated = 0;
  let totalErrors = 0;
  let totalSkipped = 0;
  
  for (const user of users) {
    const result: KeyMigrationResult = {
      userId: user.user_id,
      migratedKeys: [],
      errors: []
    };
    
    const updates: any = { user_id: user.user_id };
    let needsUpdate = false;
    
    // Migrate Claude key
    if (user.claude_api_key_encrypted) {
      if (user.claude_api_key_encrypted.startsWith('v2:')) {
        console.log(`⏭️  Skipping Claude key for user ${user.user_id.substring(0, 8)}... (already v2 format)`);
        totalSkipped++;
      } else {
        try {
          const claudeKey = await decrypt(user.claude_api_key_encrypted);
          const newEncrypted = await encrypt(claudeKey);
          updates.claude_api_key_encrypted = newEncrypted;
          result.migratedKeys.push('claude');
          needsUpdate = true;
          console.log(`✅ Migrated Claude key for user ${user.user_id.substring(0, 8)}...`);
        } catch (err: any) {
          const errorMsg = `Failed to migrate Claude key: ${err.message}`;
          result.errors.push(errorMsg);
          console.error(`❌ ${errorMsg} for user ${user.user_id.substring(0, 8)}...`);
          totalErrors++;
        }
      }
    }
    
    // Migrate Perplexity key
    if (user.perplexity_api_key_encrypted) {
      if (user.perplexity_api_key_encrypted.startsWith('v2:')) {
        console.log(`⏭️  Skipping Perplexity key for user ${user.user_id.substring(0, 8)}... (already v2 format)`);
        totalSkipped++;
      } else {
        try {
          const perplexityKey = await decrypt(user.perplexity_api_key_encrypted);
          const newEncrypted = await encrypt(perplexityKey);
          updates.perplexity_api_key_encrypted = newEncrypted;
          result.migratedKeys.push('perplexity');
          needsUpdate = true;
          console.log(`✅ Migrated Perplexity key for user ${user.user_id.substring(0, 8)}...`);
        } catch (err: any) {
          const errorMsg = `Failed to migrate Perplexity key: ${err.message}`;
          result.errors.push(errorMsg);
          console.error(`❌ ${errorMsg} for user ${user.user_id.substring(0, 8)}...`);
          totalErrors++;
        }
      }
    }
    
    // Migrate Gemini key
    if (user.gemini_api_key_encrypted) {
      if (user.gemini_api_key_encrypted.startsWith('v2:')) {
        console.log(`⏭️  Skipping Gemini key for user ${user.user_id.substring(0, 8)}... (already v2 format)`);
        totalSkipped++;
      } else {
        try {
          const geminiKey = await decrypt(user.gemini_api_key_encrypted);
          const newEncrypted = await encrypt(geminiKey);
          updates.gemini_api_key_encrypted = newEncrypted;
          result.migratedKeys.push('gemini');
          needsUpdate = true;
          console.log(`✅ Migrated Gemini key for user ${user.user_id.substring(0, 8)}...`);
        } catch (err: any) {
          const errorMsg = `Failed to migrate Gemini key: ${err.message}`;
          result.errors.push(errorMsg);
          console.error(`❌ ${errorMsg} for user ${user.user_id.substring(0, 8)}...`);
          totalErrors++;
        }
      }
    }
    
    // Update database if any keys were migrated
    if (needsUpdate) {
      try {
        const { error: updateError } = await supabase
          .from('user_api_keys')
          .update(updates)
          .eq('user_id', user.user_id);
        
        if (updateError) {
          throw updateError;
        }
        
        totalMigrated += result.migratedKeys.length;
        console.log(`💾 Updated database for user ${user.user_id.substring(0, 8)}...`);
      } catch (err: any) {
        const errorMsg = `Failed to update database: ${err.message}`;
        result.errors.push(errorMsg);
        console.error(`❌ ${errorMsg} for user ${user.user_id.substring(0, 8)}...`);
        totalErrors++;
      }
    }
    
    results.push(result);
    console.log(''); // Empty line for readability
  }
  
  // Print summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 Migration Summary');
  console.log('='.repeat(60));
  console.log(`Total users processed: ${users.length}`);
  console.log(`Total keys migrated: ${totalMigrated}`);
  console.log(`Total keys skipped (already v2): ${totalSkipped}`);
  console.log(`Total errors: ${totalErrors}`);
  
  if (totalErrors > 0) {
    console.log('\n⚠️  Some keys failed to migrate. Review errors above.');
    process.exit(1);
  } else {
    console.log('\n✅ Migration completed successfully!');
  }
}

// Run migration
migrateKeys()
  .then(() => {
    console.log('\n🎉 All done!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Migration failed:', error);
    process.exit(1);
  });

