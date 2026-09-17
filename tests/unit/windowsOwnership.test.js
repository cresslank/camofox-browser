import { jest } from '@jest/globals';
import cp from 'node:child_process';
import { captureOwnedBrowserProcesses, inspectOwnedBrowserProcesses } from '../../lib/process-ownership.js';
import { snapshotWindowsProcesses } from '../../lib/windows-processes.js';

const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform');
let query;
beforeEach(() => {
  Object.defineProperty(process, 'platform', { ...platformDescriptor, value: 'win32' });
  query = jest.spyOn(cp, 'execFileSync');
});
afterEach(() => {
  query.mockRestore();
  Object.defineProperty(process, 'platform', platformDescriptor);
});
const proc = (pid, ppid, startTime = 'start', name = 'camoufox.exe') => ({ pid, ppid, startTime, name });

test.each(['query failure', 'malformed JSON', 'invalid record'])('%s fails Windows ownership closed', kind => {
  if (kind === 'query failure') query.mockImplementation(() => { throw new Error('query failed'); });
  else query.mockReturnValue(kind === 'malformed JSON' ? '{broken' : '[{"pid":"invalid"}]');
  expect(() => snapshotWindowsProcesses({ strict: true })).toThrow();
  expect(snapshotWindowsProcesses()).toEqual([]);
  const capture = captureOwnedBrowserProcesses(100);
  expect(capture.processes).toEqual([]);
  expect(capture.indeterminate.map(item => item.pid)).toEqual([100]);
  const inspection = inspectOwnedBrowserProcesses([proc(101, 100)]);
  expect(inspection.survivors).toEqual([]);
  expect(inspection.indeterminate.map(item => item.proc.pid)).toEqual([101]);
});

test('Windows capture keeps scoped descendants and rejects missing identity', () => {
  query.mockReturnValue(JSON.stringify([proc(100, 1, 'server', 'node.exe'), proc(101, 100), proc(102, 101, ''), proc(201, 200)]));
  const capture = captureOwnedBrowserProcesses(100);
  expect(capture.processes.map(item => item.pid)).toEqual([101]);
  expect(capture.indeterminate.map(item => item.pid)).toEqual([102]);
});

test('Windows inspection rejects PID reuse and distinguishes unreadable identity', () => {
  query.mockReturnValue(JSON.stringify([proc(101, 1), proc(102, 1, 'reused'), proc(103, 1, '')]));
  const inspection = inspectOwnedBrowserProcesses([proc(101, 100), proc(102, 100), proc(103, 100), proc(104, 100)]);
  expect(inspection.survivors.map(item => item.pid)).toEqual([101]);
  expect(inspection.indeterminate.map(item => item.proc.pid)).toEqual([103]);
});
