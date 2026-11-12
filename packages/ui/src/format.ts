import { PPQ } from '@riffroll/core';

const NAMED: Record<number, string> = {
  [PPQ * 4]: '1 bar',
  [PPQ * 3]: '3/4',
  [PPQ * 2]: '1/2',
  [PPQ * 1.5]: '3/8',
  [PPQ]: '1/4',
  [PPQ * 0.75]: '3/16',
  [PPQ / 2]: '1/8',
  [PPQ / 4]: '1/16',
  [PPQ / 8]: '1/32',
  [PPQ / 16]: '1/64',
  [(PPQ * 2) / 3]: '1/4T',
  [PPQ / 3]: '1/8T',
  [PPQ / 6]: '1/16T',
};

/** Human label for a duration in ticks. */
export function lengthLabel(ticks: number): string {
  if (NAMED[ticks]) return NAMED[ticks];
  const sixteenths = ticks / (PPQ / 4);
  if (Number.isInteger(sixteenths)) return `${sixteenths}/16`;
  return `${ticks}t`;
}
