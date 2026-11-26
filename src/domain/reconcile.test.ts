import { classify, resolveRow } from './reconcile';
import type { Choice, Reading, Status } from './types';

const base = { printed: 'ready', printedRev: 1 } as const;
const mark = (status: Status): Reading => ({ kind: 'mark', status });

test('blank + desk Unavailable preserves desk, no observation', () => {
  const r = resolveRow({ ...base, desk: 'unavailable', deskRev: 2, reading: { kind: 'blank' } }, {});
  expect(r).toEqual({ state: 'resolved', cls: 'no-observation', outcome: 'no-observation', finalStatus: 'unavailable', write: false });
});
test('Needs inspection + desk unchanged Ready is a clean edit applied by default', () => {
  const r = resolveRow({ ...base, desk: 'ready', deskRev: 1, reading: mark('needs-inspection') }, {});
  expect(r).toEqual({ state: 'resolved', cls: 'clean-edit', outcome: 'applied', finalStatus: 'needs-inspection', write: true });
});
test('Unavailable + desk Unavailable is agreement without rewrite', () => {
  expect(resolveRow({ ...base, desk: 'unavailable', deskRev: 2, reading: mark('unavailable') }, {}))
    .toMatchObject({ cls: 'agreement', outcome: 'agreement', write: false });
});
test('Needs inspection + desk edited to Unavailable is an unresolved conflict', () => {
  expect(resolveRow({ ...base, desk: 'unavailable', deskRev: 2, reading: mark('needs-inspection') }, {}))
    .toEqual({ state: 'unresolved', cls: 'conflict' });
});
test.each([
  ['keep-desk', 'kept-desk', 'unavailable', false],
  ['accept-paper', 'applied', 'needs-inspection', true],
  ['defer', 'deferred', 'unavailable', false],
])('conflict resolved with %s', (choice, outcome, finalStatus, write) => {
  expect(resolveRow({ ...base, desk: 'unavailable', deskRev: 2, reading: mark('needs-inspection') }, { choice: choice as Choice }))
    .toMatchObject({ state: 'resolved', outcome, finalStatus, write });
});
test('explicit Ready + desk edited to Unavailable is a conflict', () => {
  expect(classify({ ...base, desk: 'unavailable', deskRev: 2, reading: mark('ready') })).toBe('conflict');
});
test.each([{ kind: 'double', statuses: ['ready', 'unavailable'] }, { kind: 'uncertain' }] as Reading[])(
  'unreadable row needs reading and preserves desk until resolved', (reading) => {
  expect(resolveRow({ ...base, desk: 'unavailable', deskRev: 2, reading }, {})).toEqual({ state: 'unresolved', cls: 'needs-reading' });
  expect(resolveRow({ ...base, desk: 'unavailable', deskRev: 2, reading }, { choice: 'defer' }))
    .toMatchObject({ outcome: 'deferred', finalStatus: 'unavailable', write: false });
  expect(resolveRow({ ...base, desk: 'ready', deskRev: 1, reading }, { reading: mark('unavailable') }))
    .toMatchObject({ cls: 'clean-edit', outcome: 'applied', finalStatus: 'unavailable' });
});
test('desk edited then reverted to the printed value still counts as changed', () => {
  expect(classify({ ...base, desk: 'ready', deskRev: 3, reading: mark('unavailable') })).toBe('conflict');
});
test('a correction that is itself unreadable throws', () => {
  expect(() => resolveRow({ ...base, desk: 'ready', deskRev: 1, reading: { kind: 'uncertain' } }, { reading: { kind: 'uncertain' } })).toThrow();
});
