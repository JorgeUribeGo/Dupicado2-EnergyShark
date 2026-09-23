const { Pool } = require('pg');
const config = require('../config');

const pool = new Pool({
    user: config.db.user,
    password: config.db.password,
    database: config.db.name,
    host: config.db.host,
    port: config.db.port,
    ssl: config.db.ssl ? { rejectUnauthorized: false } : false,
});

module.exports = pool;
