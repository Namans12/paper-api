import type { Reading, Resolution, RowClass, RowDecision, RowInput } from './types';

function effectiveReading(input: RowInput, decision: RowDecision): Reading {
  const correction = decision.reading;
  if (correction && correction.kind !== 'blank' && correction.kind !== 'mark') {
    throw new Error(`A correction must be blank or a single mark, got "${correction.kind}"`);
  }
  return correction ?? input.reading;
}

function classifyReading(input: RowInput, reading: Reading): RowClass {
  switch (reading.kind) {
    case 'double':
    case 'uncertain':
      return 'needs-reading';
    case 'blank':
      return 'no-observation';
    case 'mark':
      if (reading.status === input.desk) return 'agreement';
      return input.deskRev === input.printedRev ? 'clean-edit' : 'conflict';
  }
}

export function classify(input: RowInput): RowClass {
  return classifyReading(input, input.reading);
}

export function resolveRow(input: RowInput, decision: RowDecision): Resolution {
  const reading = effectiveReading(input, decision);
  const cls = classifyReading(input, reading);
  const keepDesk = (outcome: 'deferred' | 'kept-desk' | 'agreement' | 'no-observation'): Resolution =>
    ({ state: 'resolved', cls, outcome, finalStatus: input.desk, write: false });

  if (decision.choice === 'defer') return keepDesk('deferred');

  switch (cls) {
    case 'needs-reading':
      return { state: 'unresolved', cls };
    case 'no-observation':
      return keepDesk('no-observation');
    case 'agreement':
      return keepDesk('agreement');
    case 'clean-edit':
    case 'conflict': {
      if (decision.choice === 'keep-desk') return keepDesk('kept-desk');
      if (cls === 'conflict' && decision.choice !== 'accept-paper') return { state: 'unresolved', cls };
      if (reading.kind !== 'mark') throw new Error('unreachable: edit without a mark');
      return { state: 'resolved', cls, outcome: 'applied', finalStatus: reading.status, write: true };
    }
  }
}
