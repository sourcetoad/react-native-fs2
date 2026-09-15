#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { promisify } from 'node:util';

const run = promisify(execFile);

const APP = 'fs2.example';
const AGENT_DEVICE_CMD = 'npx';
const AGENT_DEVICE_ARGS = ['-y', 'agent-device@latest'];
const START_MARKER = 'RNFS2_VERIFY_SUMMARY_BEGIN';
const END_MARKER = 'RNFS2_VERIFY_SUMMARY_END';
const RESULT_TIMEOUT_MS = 5 * 60 * 1000;
const POLL_MS = 2000;

const USAGE = `Runs example/src/verify.ts on every booted simulator/emulator.

  node scripts/verify-device.mjs                 all booted mobile devices
  node scripts/verify-device.mjs ios             one platform
  node scripts/verify-device.mjs ios android

Needs Metro running for the example app, and the app already installed.`;

async function agentDevice(args, { allowFailure = false } = {}) {
  try {
    const { stdout } = await run(
      AGENT_DEVICE_CMD,
      [...AGENT_DEVICE_ARGS, ...args, '--json'],
      { maxBuffer: 32 * 1024 * 1024 }
    );
    return JSON.parse(stdout);
  } catch (e) {
    if (allowFailure) return null;
    throw new Error(
      `agent-device ${args.join(' ')} failed: ${e?.stdout || e?.stderr || e?.message}`
    );
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function parseSummary(raw) {
  if (!raw) return null;
  const start = raw.lastIndexOf(START_MARKER);
  if (start === -1) return null;
  const from = start + START_MARKER.length;
  const end = raw.indexOf(END_MARKER, from);
  if (end === -1) return null;
  try {
    return JSON.parse(raw.slice(from, end));
  } catch {
    return null;
  }
}

async function nativeLog(device) {
  if (device.platform !== 'android') return '';
  try {
    const { stdout } = await run('adb', ['-s', device.id, 'logcat', '-d'], {
      maxBuffer: 64 * 1024 * 1024,
    });
    return stdout;
  } catch {
    return '';
  }
}

async function clearNativeLog(device) {
  if (device.platform !== 'android') return;
  await run('adb', ['-s', device.id, 'logcat', '-c']).catch(() => {});
}

async function readSummary(device, logPath) {
  const captured =
    logPath && existsSync(logPath) ? readFileSync(logPath, 'utf8') : '';
  return parseSummary(captured) ?? parseSummary(await nativeLog(device));
}

async function verifyDevice(device) {
  process.stdout.write(`\n▶ ${device.platform}/${device.name}\n`);

  await agentDevice(['close'], { allowFailure: true });

  const openArgs = [
    'open',
    APP,
    '--platform',
    device.platform,
    '--device',
    device.name,
    '--relaunch',
  ];

  await agentDevice(openArgs);

  await agentDevice(['logs', 'stop'], { allowFailure: true });
  const logs =
    (await agentDevice(['logs', 'clear', '--restart'], {
      allowFailure: true,
    })) ??
    (await agentDevice(['logs', 'start'], { allowFailure: true })) ??
    (await agentDevice(['logs', 'path'], { allowFailure: true }));
  const logPath = logs?.data?.path ?? null;

  await clearNativeLog(device);
  await agentDevice(openArgs);

  const startedAt = Date.now();
  const deadline = startedAt + RESULT_TIMEOUT_MS;
  let summary = null;
  while (Date.now() < deadline) {
    summary = await readSummary(device, logPath);
    if (summary) break;
    const waited = Math.round((Date.now() - startedAt) / 1000);
    process.stdout.write(
      `\r  waiting for the suite to report... ${waited}s / ${RESULT_TIMEOUT_MS / 1000}s`
    );
    await sleep(POLL_MS);
  }
  process.stdout.write('\r'.padEnd(60) + '\r');
  await agentDevice(['close'], { allowFailure: true });

  if (!summary) {
    console.error(
      `  ✗ no result after ${RESULT_TIMEOUT_MS / 1000}s - the suite never finished,` +
        ' which is what a crash mid-run looks like'
    );
    console.error(`    log: ${logPath}`);
    return { ok: false };
  }

  const { passed, failed, skipped, failedNames, platform, osVersion } = summary;
  const ok = failed === 0;
  console.log(
    `  ${ok ? '✓' : '✗'} ${passed} passed, ${failed} failed, ${skipped} skipped` +
      ` (${platform} ${osVersion})`
  );
  for (const name of failedNames ?? []) console.log(`      ✗ ${name}`);
  if (!ok) console.log(`    log: ${logPath}`);
  return { ok };
}

async function main() {
  const args = process.argv.slice(2).map((s) => s.toLowerCase());
  if (args.includes('--help') || args.includes('-h')) {
    console.log(USAGE);
    return;
  }

  const listing = await agentDevice(['devices']);
  const devices = listing.data.devices.filter(
    (d) =>
      d.booted &&
      d.target === 'mobile' &&
      (d.kind === 'simulator' || d.kind === 'emulator') &&
      (d.platform === 'ios' || d.platform === 'android') &&
      (args.length === 0 || args.includes(d.platform))
  );

  if (devices.length === 0) {
    console.error(
      `No booted mobile device${args.length ? ` for ${args.join(', ')}` : ''}.\n\n${USAGE}`
    );
    process.exit(1);
  }

  const results = [];
  for (const device of devices) results.push(await verifyDevice(device));

  const passedCount = results.filter((r) => r.ok).length;
  console.log(`\n${passedCount}/${results.length} device(s) passed`);
  process.exit(passedCount === results.length ? 0 : 1);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
