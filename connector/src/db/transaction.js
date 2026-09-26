const pool = require('./pool');

// Corre fn(client) dentro de BEGIN/COMMIT. Es la transacción en la que se toma una decisión y se
// encola su respuesta en el outbox: o queda todo, o nada (ADR-001).
async function withTransaction(fn) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
    } catch (err) {
        // Si la conexión se cortó, el ROLLBACK también falla; el error que importa es el original.
        await client.query('ROLLBACK').catch(() => {});
        throw err;
    } finally {
        client.release();
    }
}

module.exports = { withTransaction };
