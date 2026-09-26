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

// Sin este listener, cuando Postgres se cae o reinicia, cada cliente inactivo del pool emite 'error'
// sin nadie que lo escuche y Node termina el proceso (verificado en la prueba de la anomalía #4 con
// Postgres). El pool ya descarta ese cliente solo y abre otro en la siguiente consulta; mientras la DB
// no vuelve, las consultas fallan y cada caller lo maneja (el consumer reencola el mensaje).
pool.on('error', (err) => {
    console.error(`[db] un cliente inactivo perdió la conexión con Postgres: ${err.message}`);
});

module.exports = pool;
