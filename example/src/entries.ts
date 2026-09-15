import type { ComponentType } from 'react';

import Example1 from './example1';
import Example2 from './example2';
import Example3 from './example3';
import Example4 from './example4';
import Example5 from './example5';

export type EntryKey =
  | 'example1'
  | 'example2'
  | 'example3'
  | 'example4'
  | 'example5'
  | 'verify';

export type Entry = {
  key: EntryKey;
  title: string;
  summary: string;
  /** Absent for `verify`, which the container renders itself. */
  component?: ComponentType;
};

export const ENTRIES: Entry[] = [
  {
    key: 'example1',
    title: 'Example #1',
    summary: 'mkdir, writeFile and readFile — the basic round trip',
    component: Example1,
  },
  {
    key: 'example2',
    title: 'Example #2',
    summary: 'moveFile, readDir and stat across two folders',
    component: Example2,
  },
  {
    key: 'example3',
    title: 'Example #3',
    summary: 'MediaStore: copy in, query, update and delete (Android)',
    component: Example3,
  },
  {
    key: 'example4',
    title: 'Example #4',
    summary: 'downloadFile with progress, then stat the result',
    component: Example4,
  },
  {
    key: 'example5',
    title: 'Example #5',
    summary: 'writeStream and readStream over a file',
    component: Example5,
  },
  {
    key: 'verify',
    title: 'Run Test',
    summary: 'The on-device verification suite against the real native layer',
  },
];
