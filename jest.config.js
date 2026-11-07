/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.test.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
  setupFiles: ['<rootDir>/test/setup.ts'],
  collectCoverageFrom: [
    'lib/encryption.ts',
    'worker/src/lib/encryption.ts',
  ],
  coverageDirectory: 'coverage',
  verbose: true,
};

