#!/usr/bin/env npx tsx
// ABOUTME: Admin script to create API keys directly via D1, bypassing IP rate limits.
// ABOUTME: Usage: npx tsx scripts/create-keys.ts --count 5

import { execSync } from 'child_process';

const args = process.argv.slice(2);
const countIdx = args.indexOf('--count');
const count = countIdx >= 0 ? parseInt(args[countIdx + 1]) : 1;

if (isNaN(count) || count < 1) {
  console.error('Usage: npx tsx scripts/create-keys.ts --count N');
  process.exit(1);
}

function randomHex(bytes: number): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

async function hashKey(key: string): Promise<string> {
  const encoded = new TextEncoder().encode(key);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

async function main() {
  for (let i = 0; i < count; i++) {
    const keyId = `key_${randomHex(8)}`;
    const rawKey = `hs_${randomHex(32)}`;
    const hash = await hashKey(rawKey);
    const prefix = rawKey.slice(0, 11);
    const mayorName = `Admin Mayor ${i + 1}`;

    const sql = `INSERT INTO api_keys (id, key_hash, prefix, mayor_name, created_from_ip) VALUES ('${keyId}', '${hash}', '${prefix}', '${mayorName}', 'admin-script')`;

    execSync(
      `npx wrangler d1 execute hallucinating-splines-db --command="${sql}"`,
      { cwd: `${import.meta.dirname}/../worker`, stdio: 'inherit' },
    );

    console.log(`Key ${i + 1}/${count}: ${rawKey}  (mayor: ${mayorName})`);
  }
}

main().catch(console.error);
