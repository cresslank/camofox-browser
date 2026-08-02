import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  browserDescendantTreePssMb,
  browserOwnedProcessPssMb,
  browserProcessNameRssMb,
  browserProcessTreePssMb,
  browserProcessTreeRssMb,
  evaluateBrowserMemoryPressure,
} from '../../lib/resources.js';

let procRoot;

function writeProcess(pid, options = {}) {
  const {
    ppid = 0,
    children = [],
    rssKb = 0,
    pssKb = 0,
    cmdline = 'node\0worker.js',
    startTime = '10',
  } = options;
  const base = path.join(procRoot, String(pid));
  fs.mkdirSync(path.join(base, 'task', String(pid)), { recursive: true });
  fs.writeFileSync(path.join(base, 'task', String(pid), 'children'), `${children.join(' ')}\n`);
  fs.writeFileSync(path.join(base, 'status'), `Name:\ttest-${pid}\nPPid:\t${ppid}\nVmRSS:\t${rssKb} kB\n`);
  fs.writeFileSync(path.join(base, 'stat'), `${pid} (test) S ${ppid} 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 ${startTime}`);
  fs.writeFileSync(path.join(base, 'cmdline'), cmdline);
  fs.writeFileSync(path.join(base, 'smaps_rollup'), `Pss:\t${pssKb} kB\n`);
}

beforeEach(() => {
  procRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'camofox-proc-'));
});

afterEach(() => {
  fs.rmSync(procRoot, { recursive: true, force: true });
});

describe('owned browser memory accounting', () => {
  test('counts only owned browser/Xvfb processes and excludes plugin helpers and foreign browsers', () => {
    writeProcess(100, { children: [101, 103, 104], rssKb: 10 * 1024, pssKb: 8 * 1024 });
    writeProcess(101, {
      ppid: 100,
      children: [102],
      rssKb: 120 * 1024,
      pssKb: 100 * 1024,
      cmdline: '/cache/camoufox-bin\0-foreground',
    });
    writeProcess(102, {
      ppid: 101,
      rssKb: 60 * 1024,
      pssKb: 50 * 1024,
      cmdline: '/cache/camoufox-bin\0-contentproc',
    });
    writeProcess(103, { ppid: 100, pssKb: 2000 * 1024, cmdline: '/usr/bin/yt-dlp\0video' });
    writeProcess(104, { ppid: 100, pssKb: 25 * 1024, cmdline: '/usr/bin/Xvfb\0:10' });
    writeProcess(200, { children: [201], cmdline: 'node\0foreign-server.js' });
    writeProcess(201, { ppid: 200, pssKb: 2048 * 1024, cmdline: '/cache/camoufox-bin\0-foreground' });

    expect(browserOwnedProcessPssMb(100, { procRoot })).toBe(175);
    expect(browserDescendantTreePssMb(100, { procRoot })).toBe(175);
    expect(browserProcessNameRssMb()).toBeNull();
    expect(browserProcessNameRssMb(100, { procRoot })).toBe(175);
    expect(browserProcessTreePssMb(101, { procRoot })).toBe(150);
    expect(browserProcessTreeRssMb(101, { procRoot })).toBe(180);
  });

  test('falls back to scoped RSS when smaps_rollup is unavailable', () => {
    writeProcess(101, { rssKb: 120 * 1024, pssKb: 100 * 1024 });
    fs.unlinkSync(path.join(procRoot, '101', 'smaps_rollup'));
    expect(browserProcessTreePssMb(101, { procRoot })).toBe(120);
  });

  test('returns null when the owner has no browser descendants', () => {
    writeProcess(100, { children: [101] });
    writeProcess(101, { ppid: 100, pssKb: 2000 * 1024, cmdline: '/usr/bin/yt-dlp\0video' });
    expect(browserOwnedProcessPssMb(100, { procRoot })).toBeNull();
    expect(browserDescendantTreePssMb(100, { procRoot })).toBeNull();
  });
});

describe('browser memory pressure policy', () => {
  const base = {
    thresholdMb: 1500,
    launchedAt: 10_000,
    graceMs: 60_000,
    requiredSamples: 2,
  };

  test('ignores samples during post-launch grace', () => {
    expect(evaluateBrowserMemoryPressure({
      ...base,
      browserMemoryMb: 2000,
      now: 69_999,
      consecutiveOverThreshold: 1,
    })).toEqual({ action: 'grace', consecutiveOverThreshold: 0 });
  });

  test('requires consecutive over-threshold samples before restart', () => {
    const first = evaluateBrowserMemoryPressure({
      ...base,
      browserMemoryMb: 2000,
      now: 70_000,
    });
    expect(first).toEqual({ action: 'observe', consecutiveOverThreshold: 1 });
    expect(evaluateBrowserMemoryPressure({
      ...base,
      browserMemoryMb: 2000,
      now: 100_000,
      consecutiveOverThreshold: first.consecutiveOverThreshold,
    })).toEqual({ action: 'restart', consecutiveOverThreshold: 0 });
  });

  test('a below-threshold sample resets the consecutive count', () => {
    expect(evaluateBrowserMemoryPressure({
      ...base,
      browserMemoryMb: 700,
      now: 100_000,
      consecutiveOverThreshold: 1,
    })).toEqual({ action: 'ok', consecutiveOverThreshold: 0 });
  });
});
