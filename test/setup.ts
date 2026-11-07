/**
 * Jest test setup
 * Sets up environment variables needed for encryption tests
 */

// Set test encryption key
process.env.ENCRYPTION_SECRET_KEY = 'test-encryption-key-32-characters-long-for-secure-testing';

// Set other required env vars for tests
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';

