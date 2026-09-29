const { randomUUID } = require('crypto');
const { Cycle, PendingOperation } = require('../models');
const { parsePagination } = require('./pagination');

const num = (value) => (value === null || value === undefined ? null : Number(value));

// Estados internos de pending_operations (ADR-003 + addendum) -> estados del contrato Negotiation.
const NEGOTIATION_STATUS = {
    requested: 'proposed',
    awaiting_confirmation: 'proposed',
    awaiting_payment: 'confirmed',
    settled: 'paid',
    abandoned: 'expired',
    rejected: 'rejected',
};
const INTERNAL_STATUSES = (status) => Object.keys(NEGOTIATION_STATUS).filter((k) => NEGOTIATION_STATUS[k] === status);
const PUBLIC_STATUSES = ['proposed', 'confirmed', 'paid', 'expired', 'rejected'];

function toNegotiation(op) {
    return {
        id: num(op.id),
        cycleId: op.cycleId,
        idpk: op.idpk,
        direction: op.direction,
        quantity: num(op.quantity),
        pricePerEnergy: num(op.pricePerEnergy),
        // Precio al que liquidó la central, de su confirmación give/take (U6).
        settledPricePerEnergy: op.confirmation ? num(op.confirmation.data.pricePerEnergy) : null,
        status: NEGOTIATION_STATUS[op.status] || op.status,
        proposedAt: op.createdAt,
        confirmedAt: op.confirmedAt || null,
        paidAt: op.paidAt || null,
        origin: op.origin,
        attempts: op.attempts,
        failureReason: op.failureReason || null,
        failureDetail: op.failureDetail || null,
    };
}

const isPositiveNumber = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;

// Valida el body de POST /api/negotiations. Devuelve un mensaje de error o null.
function validateProposal(body) {
    if (!body || typeof body !== 'object') return 'body JSON requerido';
    const { cycleId, direction, quantity, pricePerEnergy } = body;
    if (typeof cycleId !== 'string' || cycleId.length === 0 || cycleId.length > 40) return 'cycleId debe ser un string de 1 a 40 caracteres';
    if (direction !== 'give' && direction !== 'take') return 'direction debe ser give o take';
    if (!isPositiveNumber(quantity)) return 'quantity debe ser un número positivo';
    if (!isPositiveNumber(pricePerEnergy)) return 'pricePerEnergy debe ser un número positivo';
    return null;
}

// RF04: solo se registra la intención (status 'requested'); la publica el sweeper de U6
// (ADR-003, addendum). api nunca toca el broker (ADR-001).
async function createNegotiation(req, res) {
    const invalid = validateProposal(req.body);
    if (invalid) return res.status(400).json({ error: invalid });

    const { cycleId, direction, quantity, pricePerEnergy } = req.body;
    try {
        const cycle = await Cycle.findByPk(cycleId);
        if (!cycle) return res.status(409).json({ error: `el ciclo ${cycleId} no existe` });
        if (cycle.phase !== 'negotiating' || !cycle.windowClosesAt || cycle.windowClosesAt <= new Date()) {
            return res.status(409).json({ error: `el ciclo ${cycleId} no está en ventana de negociación` });
        }
        const op = await PendingOperation.create({
            idpk: randomUUID(),
            cycleId,
            direction,
            quantity,
            pricePerEnergy,
            status: 'requested',
            attempts: 0, // envíos de la propuesta: el sweeper pone 1 al publicarla (el default 1 es de ADR-003)
        });
        return res.status(201).json(toNegotiation(await op.reload()));
    } catch (error) {
        console.error('Error al crear la negociación:', error);
        return res.status(500).json({ error: 'Error interno del servidor' });
    }
}

async function listNegotiations(req, res) {
    const { status } = req.query;
    if (status !== undefined && !PUBLIC_STATUSES.includes(status)) {
        return res.status(400).json({ error: `status inválido (${PUBLIC_STATUSES.join(' | ')})` });
    }
    try {
        const { page, limit, offset } = parsePagination(req.query);
        const { count, rows } = await PendingOperation.findAndCountAll({
            where: status ? { status: INTERNAL_STATUSES(status) } : {},
            order: [['id', 'DESC']],
            limit,
            offset,
        });
        return res.status(200).json({
            page,
            limit,
            total: count,
            totalPages: Math.ceil(count / limit),
            data: rows.map(toNegotiation),
        });
    } catch (error) {
        console.error('Error al listar negociaciones:', error);
        return res.status(500).json({ error: 'Error interno del servidor' });
    }
}

async function getNegotiation(req, res) {
    if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ error: 'id inválido (debe ser un número)' });
    try {
        const op = await PendingOperation.findByPk(req.params.id);
        if (!op) return res.status(404).json({ error: 'negociación no encontrada' });
        return res.status(200).json(toNegotiation(op));
    } catch (error) {
        console.error('Error al obtener la negociación:', error);
        return res.status(500).json({ error: 'Error interno del servidor' });
    }
}

module.exports = { createNegotiation, listNegotiations, getNegotiation, toNegotiation, validateProposal };
