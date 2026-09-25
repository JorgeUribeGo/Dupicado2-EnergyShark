// Misma convención que /history de la E0 (page/limit), con tope para no servir tablas enteras.
const MAX_LIMIT = 100;

function parsePagination(query) {
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 25, 1), MAX_LIMIT);
    return { page, limit, offset: (page - 1) * limit };
}

module.exports = { parsePagination };
