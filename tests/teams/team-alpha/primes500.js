/**
 * Calculate the first 500 prime numbers
 * Shows detailed work and verification
 */

function isPrime(num) {
  if (num < 2) return false;
  if (num === 2) return true;
  if (num % 2 === 0) return false;

  // Only need to check up to square root of num
  const sqrt = Math.sqrt(num);
  for (let i = 3; i <= sqrt; i += 2) {
    if (num % i === 0) return false;
  }

  return true;
}

function findFirstNPrimes(n) {
  const primes = [];
  let candidate = 2;
  let checksPerformed = 0;

  console.log(`Starting calculation of first ${n} prime numbers...\n`);

  while (primes.length < n) {
    if (isPrime(candidate)) {
      primes.push(candidate);

      // Show progress every 50 primes
      if (primes.length % 50 === 0) {
        console.log(`Progress: Found ${primes.length} primes (latest: ${candidate})`);
      }
    }
    checksPerformed++;
    candidate++;
  }

  console.log(`\nCompleted! Checked ${checksPerformed} candidates to find ${n} primes.\n`);
  return primes;
}

// Calculate first 500 primes
const primes = findFirstNPrimes(500);

console.log('='.repeat(80));
console.log('THE FIRST 500 PRIME NUMBERS');
console.log('='.repeat(80));
console.log();

// Display in rows of 10 for readability
for (let i = 0; i < primes.length; i += 10) {
  const row = primes.slice(i, i + 10);
  const rowLabel = `${String(i + 1).padStart(3)}-${String(Math.min(i + 10, 500)).padStart(3)}:`;
  const formattedRow = row.map(n => String(n).padStart(4)).join(', ');
  console.log(rowLabel + '  ' + formattedRow);
}

console.log();
console.log('='.repeat(80));
console.log('STATISTICS');
console.log('='.repeat(80));
console.log(`Total primes found:        ${primes.length}`);
console.log(`Smallest prime:            ${primes[0]}`);
console.log(`Largest prime (500th):     ${primes[primes.length - 1]}`);
console.log(`Sum of all 500 primes:     ${primes.reduce((a, b) => a + b, 0).toLocaleString()}`);
console.log(`Average value:             ${(primes.reduce((a, b) => a + b, 0) / primes.length).toFixed(2)}`);
console.log(`Median value:              ${primes[249]} and ${primes[250]}`);

console.log();
console.log('='.repeat(80));
console.log('VERIFICATION - First 20 primes with divisibility check');
console.log('='.repeat(80));

for (let i = 0; i < 20; i++) {
  const p = primes[i];
  const factors = [];

  // Check all potential factors
  for (let j = 2; j < p; j++) {
    if (p % j === 0) {
      factors.push(j);
    }
  }

  if (factors.length === 0) {
    console.log(`Prime #${String(i + 1).padStart(2)}: ${String(p).padStart(3)} ✓ No divisors found (only 1 and ${p})`);
  } else {
    console.log(`Prime #${String(i + 1).padStart(2)}: ${String(p).padStart(3)} ✗ ERROR - divisible by: ${factors.join(', ')}`);
  }
}

console.log();
console.log('='.repeat(80));
console.log('ANALYSIS BY RANGES');
console.log('='.repeat(80));

const ranges = [
  { start: 0, end: 100, label: '1-100' },
  { start: 100, end: 200, label: '101-200' },
  { start: 200, end: 300, label: '201-300' },
  { start: 300, end: 400, label: '301-400' },
  { start: 400, end: 500, label: '401-500' }
];

ranges.forEach(range => {
  const primesInRange = primes.filter(p => p >= range.start && p < range.end);
  console.log(`Range ${range.label.padEnd(10)}: ${String(primesInRange.length).padStart(2)} primes found`);
});

console.log();
console.log('='.repeat(80));
console.log('INTERESTING FACTS');
console.log('='.repeat(80));

// Twin primes (primes that differ by 2)
const twinPrimes = [];
for (let i = 0; i < primes.length - 1; i++) {
  if (primes[i + 1] - primes[i] === 2) {
    twinPrimes.push([primes[i], primes[i + 1]]);
  }
}
console.log(`Twin primes found: ${twinPrimes.length} pairs`);
console.log(`Examples: ${twinPrimes.slice(0, 5).map(pair => `(${pair[0]}, ${pair[1]})`).join(', ')}`);

// Largest gap between consecutive primes
let largestGap = 0;
let gapLocation = null;
for (let i = 0; i < primes.length - 1; i++) {
  const gap = primes[i + 1] - primes[i];
  if (gap > largestGap) {
    largestGap = gap;
    gapLocation = [primes[i], primes[i + 1]];
  }
}
console.log(`Largest gap: ${largestGap} (between ${gapLocation[0]} and ${gapLocation[1]})`);

console.log();
console.log('='.repeat(80));
console.log('CALCULATION COMPLETE');
console.log('='.repeat(80));
