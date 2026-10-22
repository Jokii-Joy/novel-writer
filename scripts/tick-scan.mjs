// Temporary diagnostic: list lines containing a backtick in a source part.
import { readFileSync } from 'node:fs';

const file = process.argv[2];
const lines = readFileSync(file, 'utf8').split(/\r?\n/);
lines.forEach((line, index) => {
  if (line.includes('`')) {
    console.log(`${index + 1}: ${line.slice(0, 140)}`);
  }
});
