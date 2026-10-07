const { sequelize } = require('../models');

// Shape DistanceTable de openapi.yaml. Sin tabla recibida: distances vacío y updatedAt null
// (ADR-002, addendum 3).
function toDistanceTable(row) {
    if (!row) return { cityId: null, updatedAt: null, distances: {} };
    return {
        cityId: row.payload.cityId ?? null,
        updatedAt: row.sent_at,
        distances: row.payload.data.distances,
    };
}

// RF02: la vigente es la de timestamp más reciente, no la última en llegar.
async function getDistanceTable(req, res) {
    try {
        const [rows] = await sequelize.query(
            'SELECT payload, sent_at FROM distance_tables ORDER BY sent_at DESC, id DESC LIMIT 1',
        );
        return res.status(200).json(toDistanceTable(rows[0]));
    } catch (error) {
        console.error('Error al leer la distance-table:', error);
        return res.status(500).json({ error: 'Error interno del servidor' });
    }
}

module.exports = { getDistanceTable, toDistanceTable };
