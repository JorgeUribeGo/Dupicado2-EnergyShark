const { Op } = require('sequelize');
const { Cycle, LedgerEvent, PendingOperation } = require('../models');
const { parsePagination } = require('./pagination');
const { toNegotiation } = require('./negotiationsController');

// DECIMAL de Postgres llega como string; el contrato (openapi.yaml) expone number.
const num = (value) => (value === null || value === undefined ? null : Number(value));

// Arma el CycleSummary de openapi.yaml (RF01). events viene ordenado por id ASC.
function toCycleSummary(cycle, events, ops) {
    const ss = cycle.statusStatement;
    const report = cycle.negotiationReport;
    const last = events[events.length - 1];
    const energy = ss && ss.data && ss.data.energy;

    return {
        cycleId: cycle.cycleId,
        phase: cycle.phase,
        windowOpensAt: cycle.windowOpensAt,
        windowClosesAt: cycle.windowClosesAt,
        statusStatement: ss ? ss.data : null,
        transfersReceived: events.filter((e) => e.type === 'transfer').map((e) => ({
            msgId: e.msgId,
            quantity: num(e.deltaBudget),
            becauseOf: e.payload.data.becauseOf || null,
            receivedAt: e.appliedAt,
        })),
        demandStatementsApplied: events.filter((e) => e.type === 'demand-statement').map((e) => ({
            msgId: e.msgId,
            quantity: e.payload.data.balance.quantity,
            valuePerKwh: e.payload.data.balance.valuePerKwh,
            appliedAt: e.appliedAt,
        })),
        voluntaryNegotiations: ops.map(toNegotiation),
        // U5 guarda el envelope enviado; se acepta también solo `data` por si cambia.
        negotiationReportSent: report ? {
            budgetBalance: num((report.data || report).budgetBalance),
            energyBalance: num((report.data || report).energyBalance),
            sentAt: report.timestamp || null,
        } : null,
        // Budget: saldo global tras la última operación del ciclo. Energía: (generación - consumo)
        // + movimientos del ciclo (ADR-002, addendum §3). null si no hay con qué calcularlo.
        finalBalances: {
            budget: last ? num(last.resultingBudget) : null,
            energy: energy ? energy.generationCapacity - energy.consumption + (last ? num(last.resultingEnergy) : 0) : null,
        },
        lastOperationApplied: last ? { type: last.type, appliedAt: last.appliedAt } : null,
    };
}

async function summarize(cycles) {
    const cycleIds = cycles.map((c) => c.cycleId);
    const [events, ops] = await Promise.all([
        LedgerEvent.findAll({ where: { cycleId: { [Op.in]: cycleIds } }, order: [['id', 'ASC']] }),
        PendingOperation.findAll({ where: { cycleId: { [Op.in]: cycleIds } }, order: [['id', 'ASC']] }),
    ]);
    return cycles.map((c) => toCycleSummary(
        c,
        events.filter((e) => e.cycleId === c.cycleId),
        ops.filter((o) => o.cycleId === c.cycleId),
    ));
}

async function listCycles(req, res) {
    try {
        const { page, limit, offset } = parsePagination(req.query);
        const { count, rows } = await Cycle.findAndCountAll({
            order: [['createdAt', 'DESC']],
            limit,
            offset,
        });
        return res.status(200).json({
            page,
            limit,
            total: count,
            totalPages: Math.ceil(count / limit),
            data: await summarize(rows),
        });
    } catch (error) {
        console.error('Error al listar ciclos:', error);
        return res.status(500).json({ error: 'Error interno del servidor' });
    }
}

async function getCycle(req, res) {
    try {
        const cycle = await Cycle.findByPk(req.params.cycleId);
        if (!cycle) return res.status(404).json({ error: 'cycleId no existe' });
        const [summary] = await summarize([cycle]);
        return res.status(200).json(summary);
    } catch (error) {
        console.error('Error al obtener el ciclo:', error);
        return res.status(500).json({ error: 'Error interno del servidor' });
    }
}

module.exports = { listCycles, getCycle, toCycleSummary };
