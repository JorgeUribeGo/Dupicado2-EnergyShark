const { RejectedMessage } = require('../models');
const { parsePagination } = require('./pagination');

const KINDS = ['duplicate', 'nack', 'discarded'];

function toRejectedMessage(r) {
    return {
        id: Number(r.id),
        kind: r.kind,
        type: r.msgType,
        idpk: r.idpk,
        msgId: r.msgId,
        reason: r.reason,
        code: r.code,
        detail: r.detail,
        occurredAt: r.occurredAt,
    };
}

// RF05: log de duplicados, descartados y NACKs, lo más reciente primero.
async function listRejected(req, res) {
    const { kind } = req.query;
    if (kind !== undefined && !KINDS.includes(kind)) {
        return res.status(400).json({ error: `kind inválido (${KINDS.join(' | ')})` });
    }
    try {
        const { page, limit, offset } = parsePagination(req.query);
        const { count, rows } = await RejectedMessage.findAndCountAll({
            where: kind ? { kind } : {},
            order: [['id', 'DESC']],
            limit,
            offset,
        });
        return res.status(200).json({
            page,
            limit,
            total: count,
            totalPages: Math.ceil(count / limit),
            data: rows.map(toRejectedMessage),
        });
    } catch (error) {
        console.error('Error al listar mensajes rechazados:', error);
        return res.status(500).json({ error: 'Error interno del servidor' });
    }
}

module.exports = { listRejected };
