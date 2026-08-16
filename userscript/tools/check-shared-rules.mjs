import fs from 'node:fs';

const rules = JSON.parse(fs.readFileSync('src/rules.json', 'utf8'));
const candidate = fs.readFileSync('candidate/Weekend-Wegwijzer.user.js', 'utf8');
const python = fs.readFileSync('../radar.py', 'utf8');

for (const airport of rules.airports) {
  if (!candidate.includes(`'${airport}'`) || !python.includes('SHARED_RULES')) {
    throw new Error(`Shared airport rule is not wired: ${airport}`);
  }
}
if (!candidate.includes(`fridayEarliestDeparture: '${rules.fridayEarliestDeparture}'`)) {
  throw new Error('Candidate Friday rule differs from shared rules');
}
console.log('shared rules: OK');
