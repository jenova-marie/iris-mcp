const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

/**
 * Check if a number is prime
 * @param {number} num - Number to check
 * @returns {boolean} - True if prime, false otherwise
 */
function isPrime(num) {
  if (num <= 1) return false;
  if (num <= 3) return true;
  if (num % 2 === 0 || num % 3 === 0) return false;

  // Check for divisors up to sqrt(num)
  for (let i = 5; i * i <= num; i += 6) {
    if (num % i === 0 || num % (i + 2) === 0) return false;
  }

  return true;
}

/**
 * Calculate the first n prime numbers
 * @param {number} count - Number of primes to calculate
 * @returns {number[]} - Array of prime numbers
 */
function calculatePrimes(count) {
  if (count <= 0) return [];

  const primes = [];
  let candidate = 2;

  while (primes.length < count) {
    if (isPrime(candidate)) {
      primes.push(candidate);
    }
    candidate++;
  }

  return primes;
}

/**
 * GET /api/primes/:count
 * Calculate and return the first n prime numbers
 */
app.get('/api/primes/:count', (req, res) => {
  const count = parseInt(req.params.count, 10);

  // Validation
  if (isNaN(count)) {
    return res.status(400).json({
      error: 'Invalid input',
      message: 'Count must be a valid number'
    });
  }

  if (count < 0) {
    return res.status(400).json({
      error: 'Invalid input',
      message: 'Count must be a positive number'
    });
  }

  if (count > 10000) {
    return res.status(400).json({
      error: 'Invalid input',
      message: 'Count must not exceed 10000 (to prevent excessive computation)'
    });
  }

  const startTime = Date.now();
  const primes = calculatePrimes(count);
  const computationTime = Date.now() - startTime;

  res.json({
    count: count,
    primes: primes,
    computationTime: `${computationTime}ms`
  });
});

/**
 * GET /api/health
 * Health check endpoint
 */
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Prime Number API',
    timestamp: new Date().toISOString()
  });
});

/**
 * GET /
 * Root endpoint with API documentation
 */
app.get('/', (req, res) => {
  res.json({
    message: 'Prime Number API',
    endpoints: {
      '/api/primes/:count': {
        method: 'GET',
        description: 'Calculate the first n prime numbers',
        parameters: {
          count: 'Number of primes to calculate (1-10000)'
        },
        example: '/api/primes/10'
      },
      '/api/health': {
        method: 'GET',
        description: 'Health check endpoint'
      }
    }
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: err.message
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`Prime Number API server listening on port ${PORT}`);
  console.log(`Try: http://localhost:${PORT}/api/primes/10`);
});
