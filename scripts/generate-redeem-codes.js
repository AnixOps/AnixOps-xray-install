#!/usr/bin/env node
/**
 * Redeem Code Generator for AnixOps
 *
 * Usage: node scripts/generate-redeem-codes.js <count> <duration_hours> [expires_at]
 * Example: node scripts/generate-redeem-codes.js 10 8
 * Example: node scripts/generate-redeem-codes.js 10 8 2026-12-31T23:59:59Z
 *
 * Requires: API_SECRET environment variable set to the same value as Workers
 */

const https = require('https');

const WORKER_URL = process.env.WORKER_URL || 'https://anixops.your-subdomain.workers.dev';
const API_SECRET = process.env.API_SECRET;

if (!API_SECRET) {
  console.error('Error: API_SECRET environment variable not set');
  process.exit(1);
}

const [,, count, durationHours, expiresAt] = process.argv;

if (!count || !durationHours) {
  console.error('Usage: node generate-redeem-codes.js <count> <duration_hours> [expires_at]');
  console.error('Example: node generate-redeem-codes.js 10 8');
  console.error('Example: node generate-redeem-codes.js 10 8 2026-12-31T23:59:59Z');
  console.error('');
  console.error('Valid durations: 1, 6, 8, 12, 16, 24, 48, 72 hours');
  process.exit(1);
}

const validDurations = [1, 6, 8, 12, 16, 24, 48, 72];
if (!validDurations.includes(parseInt(durationHours))) {
  console.error(`Error: Invalid duration. Valid durations: ${validDurations.join(', ')}`);
  process.exit(1);
}

const postData = JSON.stringify({
  count: parseInt(count),
  durationHours: parseInt(durationHours),
  expiresAt: expiresAt || null,
});

const options = {
  hostname: WORKER_URL.replace(/^https?:\/\//, ''),
  port: 443,
  path: '/api/admin/redeem-codes',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-API-Secret': API_SECRET,
    'Content-Length': Buffer.byteLength(postData),
  },
};

const req = https.request(options, (res) => {
  let data = '';

  res.on('data', (chunk) => {
    data += chunk;
  });

  res.on('end', () => {
    try {
      const result = JSON.parse(data);
      if (res.statusCode !== 200) {
        console.error('Error:', result.error || 'Unknown error');
        process.exit(1);
      }

      console.log('\n✅ Generated', result.count, 'redeem codes:\n');
      console.log('Duration:', durationHours, 'hours');
      if (expiresAt) console.log('Expires at:', expiresAt);
      console.log('');
      console.log('Codes:');
      console.log('='.repeat(30));
      result.codes.forEach(({ code }, index) => {
        console.log(`${index + 1}. ${code}`);
      });
      console.log('='.repeat(30));
      console.log('');
    } catch (e) {
      console.error('Error parsing response:', e.message);
      console.error('Raw response:', data);
      process.exit(1);
    }
  });
});

req.on('error', (e) => {
  console.error('Request failed:', e.message);
  process.exit(1);
});

req.write(postData);
req.end();
