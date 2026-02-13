module.exports = {
  transform: {
    '^.+\\.[jt]sx?$': 'babel-jest',
  },
  transformIgnorePatterns: [
    'node_modules/(?!(firebase|@firebase)/)',
  ],
  testMatch: ['**/firestore.rules.test.ts'],
  testTimeout: 30000,
};
