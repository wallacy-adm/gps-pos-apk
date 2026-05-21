module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  transformIgnorePatterns: [
    'node_modules/(?!(expo-location|expo-task-manager|expo-device|expo-application|expo-status-bar|@expo|expo)/)',
  ],
  testMatch: ['**/__tests__/**/*.test.ts'],
  setupFiles: [],
};
