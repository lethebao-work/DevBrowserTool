#!/usr/bin/env node

import { runCli } from '../dist/index.js';

runCli(process.argv.slice(2)).catch(err => {
  console.error('CLI Error:', err);
  process.exit(1);
});
