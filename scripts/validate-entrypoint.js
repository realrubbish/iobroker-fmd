#!/usr/bin/env node
/**
 * Validates that the compiled entry point exists at the path declared in package.json's `main` field.
 * Exits with code 1 if the entry point is missing.
 */

const path = require('path');
const fs = require('fs');

const packageJsonPath = path.resolve(__dirname, '..', 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

const mainPath = path.resolve(__dirname, '..', packageJson.main);

if (!fs.existsSync(mainPath)) {
  console.error(`ERROR: Entry point mismatch!`);
  console.error(`  package.json main: ${packageJson.main}`);
  console.error(`  Expected file:    ${mainPath}`);
  console.error(`  File does not exist.`);
  process.exit(1);
}

console.log(`✓ Entry point validated: ${packageJson.main}`);
