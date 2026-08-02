import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  browserDescendantTreePssMb,
  browserProcessNameRssMb,
  browserProcessTreePssMb,
  browserProcessTreeRssMb,
  evaluateBrowserMemoryPressure,
} from '../../lib/resources.js';

let procRoot;

function writeProcess(pid, { children = [], rssKb = 0, pssKb = 0 } = {}) {
  const base = path.join(procRoot, String(pid));
  fs.mkdirSync(path.join(base, 'task', String(pid)), { recursive: true });
  fs.writeFileSync(path.join(base, 'task', String(pid), 'children'), `${children.join(' ')}\n`);
  fs.writeFileSync(path.join(base, 'status'), `Name:\ttest-${pid}\nVmRSS:\t${rssKb} kB\n`);
  fs.writeFileSync(path.join(base, 'smaps_rollup'), `Pss:\t${pssKb} kB\n`);
}

beforeEach(() => {
  procRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'camofox-proc-'));
});

afterEach(() => {
  fs.rmSync(procRoot, { recursive: true, force: true });
});

describe('owned browser memory accounting', () => {
  test('counts only descendants of the Camofox server and excludes foreign browsers', () => {
    writeProcess(100, { children: [101], rssKb: 10 * 1024, pssKb: 8 * 1024 });
    writeProcess(101, { children: [102], rssKb: 120 * 1024, pssKb: 100 * 1024 });
    writeProcess(102, { rssKb: 60 * 1024, pssKb: 50 * 1024 });
    writeProcess(200, { rssKb: 4096 * 1024, pssKb: 2048 * 1024 });

    expect(browserDescendantTreePssMb(100, { procRoot })).toBe(150);
    expect(browserProcessNameRssMb()).toBeNull();
    expect(browserProcessNameRssMb(100, { procRoot })).toBe(150);
    expect(browserProcessTreePssMb(101, { procRoot })).toBe(150);
    expect(browserProcessTreeRssMb(101, { procRoot })).toBe(180);
  });

  test('returns null when the owner has no browser descendants', () => {
    writeProcess(100);
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
