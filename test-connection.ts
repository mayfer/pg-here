import pg from 'pg';

const client = new pg.Client('postgresql://postgres:postgres@localhost:55432/postgres');

try {
  await client.connect();
  console.log('✅ Connected to PostgreSQL');

  const result = await client.query('SELECT version()');
  console.log('PostgreSQL version:', result.rows[0].version);

  await client.end();
} catch (err) {
  console.error('❌ Connection failed:', err.message);
  process.exit(1);
}
