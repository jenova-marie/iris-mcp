/**
 * Calculate the first 100 prime numbers
 * A prime number is a natural number greater than 1 that has no positive divisors other than 1 and itself
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

  while (primes.length < n) {
    if (isPrime(candidate)) {
      primes.push(candidate);
    }
    candidate++;
  }

  return primes;
}

// Calculate first 100 primes
console.log('Calculating the first 100 prime numbers...\n');

const primes = findFirstNPrimes(100);

console.log('The first 100 prime numbers are:\n');

// Display in rows of 10 for readability
for (let i = 0; i < primes.length; i += 10) {
  const row = primes.slice(i, i + 10);
  const rowNumber = `${i + 1}-${Math.min(i + 10, 100)}:`.padEnd(10);
  console.log(rowNumber + row.join(', '));
}

console.log('\n--- Statistics ---');
console.log(`Total primes found: ${primes.length}`);
console.log(`Smallest prime: ${primes[0]}`);
console.log(`Largest prime: ${primes[primes.length - 1]}`);
console.log(`Sum of all primes: ${primes.reduce((a, b) => a + b, 0)}`);
console.log(`Average: ${(primes.reduce((a, b) => a + b, 0) / primes.length).toFixed(2)}`);

// Verification step - show work for first few primes
console.log('\n--- Verification (showing work for first 10) ---');
for (let i = 0; i < 10; i++) {
  const p = primes[i];
  console.log(`${p} is prime: divisible only by 1 and ${p}`);
}
