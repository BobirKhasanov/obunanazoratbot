// Creates a throwaway Postgres database for one test run (default: local server on :54329, see TEST_PG_URL)
const crypto = require('crypto');
const { Client } = require('pg');

const ADMIN = process.env.TEST_PG_URL || 'postgres://postgres@127.0.0.1:54329/postgres';

async function freshDb() {
  const name = `chess_${crypto.randomBytes(5).toString('hex')}`;
  const admin = new Client({ connectionString: ADMIN });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();
  const url = ADMIN.replace(/\/[^/]*$/, `/${name}`);
  const client = new Client({ connectionString: url });
  await client.connect();
  return {
    url,
    q: (sql, ...p) => client.query(sql, p).then((r) => r.rows),
    async drop() {
      await client.end().catch(() => {});
      const a = new Client({ connectionString: ADMIN });
      await a.connect();
      await a.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`).catch(() => {});
      await a.end();
    },
  };
}
module.exports = { freshDb };
