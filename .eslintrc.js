module.exports = {
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: 'tsconfig.json',
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint/eslint-plugin'],
  extends: ['google', 'plugin:prettier/recommended', 'prettier'],
  root: true,
  env: {
    node: true,
    jest: true,
  },
  ignorePatterns: ['.eslintrc.js', '**/migrations/*', '**/seed/*'],
  rules: {
    'new-cap': 0,
    'require-jsdoc': 0,
    'no-unused-vars': 'off',
    strict: 0,
  },
};
