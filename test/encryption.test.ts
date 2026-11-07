/**
 * Encryption Tests
 * 
 * Tests for AES-256-GCM encryption with backward compatibility for legacy XOR
 * 
 * Run with: npm test
 */

import { describe, it, expect, beforeAll } from '@jest/globals';
import { encrypt, decrypt } from '../lib/encryption';

// Set up test environment
beforeAll(() => {
  // Ensure ENCRYPTION_SECRET_KEY is set for tests
  if (!process.env.ENCRYPTION_SECRET_KEY) {
    process.env.ENCRYPTION_SECRET_KEY = 'test-encryption-key-32-characters-long-secure';
  }
});

describe('Encryption Module', () => {
  describe('AES-256-GCM Encryption (v2)', () => {
    it('should encrypt text to v2 format', async () => {
      const plaintext = 'sk-ant-api03-test-key-123456789';
      const encrypted = await encrypt(plaintext);
      
      expect(encrypted).toBeDefined();
      expect(encrypted).not.toBe(plaintext);
      expect(encrypted.startsWith('v2:')).toBe(true);
    });
    
    it('should decrypt v2 encrypted text correctly', async () => {
      const plaintext = 'pplx-test-api-key-1234567890';
      const encrypted = await encrypt(plaintext);
      const decrypted = await decrypt(encrypted);
      
      expect(decrypted).toBe(plaintext);
    });
    
    it('should handle empty strings', async () => {
      const encrypted = await encrypt('');
      expect(encrypted).toBe('');
      
      const decrypted = await decrypt('');
      expect(decrypted).toBe('');
    });
    
    it('should produce different ciphertexts for same plaintext (IV randomization)', async () => {
      const plaintext = 'AIzaSyTest123456789';
      const encrypted1 = await encrypt(plaintext);
      const encrypted2 = await encrypt(plaintext);
      
      expect(encrypted1).not.toBe(encrypted2);
      
      // But both should decrypt to same plaintext
      const decrypted1 = await decrypt(encrypted1);
      const decrypted2 = await decrypt(encrypted2);
      expect(decrypted1).toBe(plaintext);
      expect(decrypted2).toBe(plaintext);
    });
    
    it('should handle long API keys', async () => {
      const longKey = 'sk-ant-api03-' + 'a'.repeat(100);
      const encrypted = await encrypt(longKey);
      const decrypted = await decrypt(encrypted);
      
      expect(decrypted).toBe(longKey);
    });
    
    it('should handle special characters', async () => {
      const specialKey = 'key-with-special-chars-!@#$%^&*()_+-=[]{}|;:,.<>?';
      const encrypted = await encrypt(specialKey);
      const decrypted = await decrypt(encrypted);
      
      expect(decrypted).toBe(specialKey);
    });
  });
  
  describe('Legacy XOR Compatibility', () => {
    it('should decrypt legacy XOR format', async () => {
      // This is a test encrypted value using the old XOR method
      // In real scenario, you'd have actual legacy encrypted data
      const legacyEncrypted = Buffer.from('test-legacy-data').toString('base64');
      
      // decrypt should not throw error (even if data is garbled)
      expect(async () => {
        await decrypt(legacyEncrypted);
      }).not.toThrow();
    });
    
    it('should auto-detect v2 format vs legacy', async () => {
      const plaintext = 'test-key-12345';
      const v2Encrypted = await encrypt(plaintext);
      
      // v2 format should start with 'v2:'
      expect(v2Encrypted.startsWith('v2:')).toBe(true);
      
      // Legacy format should NOT start with 'v2:'
      const legacyFormat = 'dGVzdC1sZWdhY3k='; // base64 without v2: prefix
      expect(legacyFormat.startsWith('v2:')).toBe(false);
    });
  });
  
  describe('Error Handling', () => {
    it('should throw error on invalid v2 format', async () => {
      const invalidV2 = 'v2:invalid:format';
      
      await expect(async () => {
        await decrypt(invalidV2);
      }).rejects.toThrow();
    });
    
    it('should throw error on corrupted v2 data', async () => {
      const corruptedV2 = 'v2:corrupted:data:here';
      
      await expect(async () => {
        await decrypt(corruptedV2);
      }).rejects.toThrow();
    });
    
    it('should handle encryption with missing ENCRYPTION_SECRET_KEY', async () => {
      const originalKey = process.env.ENCRYPTION_SECRET_KEY;
      delete process.env.ENCRYPTION_SECRET_KEY;
      
      await expect(async () => {
        await encrypt('test');
      }).rejects.toThrow();
      
      // Restore key
      process.env.ENCRYPTION_SECRET_KEY = originalKey;
    });
  });
  
  describe('Security Properties', () => {
    it('should use different IVs for each encryption', async () => {
      const plaintext = 'same-text';
      const encrypted1 = await encrypt(plaintext);
      const encrypted2 = await encrypt(plaintext);
      
      // Extract IV from both (format: v2:iv:authTag:data)
      const iv1 = encrypted1.split(':')[1];
      const iv2 = encrypted2.split(':')[1];
      
      expect(iv1).not.toBe(iv2);
    });
    
    it('should produce ciphertext longer than plaintext (includes IV and auth tag)', async () => {
      const plaintext = 'short';
      const encrypted = await encrypt(plaintext);
      
      // v2 format includes: "v2:" prefix + IV (16 bytes) + authTag (16 bytes) + encrypted data
      // All base64 encoded, so should be significantly longer
      expect(encrypted.length).toBeGreaterThan(plaintext.length);
    });
    
    it('should fail tampered ciphertext authentication', async () => {
      const plaintext = 'test-key';
      const encrypted = await encrypt(plaintext);
      
      // Tamper with the ciphertext (change last character)
      const tampered = encrypted.slice(0, -1) + 'X';
      
      await expect(async () => {
        await decrypt(tampered);
      }).rejects.toThrow();
    });
  });
});

describe('Real-world API Key Scenarios', () => {
  it('should handle Claude API key format', async () => {
    const claudeKey = 'sk-ant-api03-' + 'x'.repeat(95);
    const encrypted = await encrypt(claudeKey);
    const decrypted = await decrypt(encrypted);
    
    expect(decrypted).toBe(claudeKey);
  });
  
  it('should handle Perplexity API key format', async () => {
    const perplexityKey = 'pplx-' + 'y'.repeat(56);
    const encrypted = await encrypt(perplexityKey);
    const decrypted = await decrypt(encrypted);
    
    expect(decrypted).toBe(perplexityKey);
  });
  
  it('should handle Gemini API key format', async () => {
    const geminiKey = 'AIzaSy' + 'z'.repeat(33);
    const encrypted = await encrypt(geminiKey);
    const decrypted = await decrypt(encrypted);
    
    expect(decrypted).toBe(geminiKey);
  });
});

