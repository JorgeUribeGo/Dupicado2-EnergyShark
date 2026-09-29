jest.mock('../models', () => ({ Cycle: { findByPk: jest.fn() }, PendingOperation: { create: jest.fn() } }));

const { Cycle, PendingOperation } = require('../models');
const { createNegotiation, validateProposal, toNegotiation } = require('./negotiationsController');

const ok = { cycleId: 'cycle-1', direction: 'take', quantity: 2024, pricePerEnergy: 215 };

test('validateProposal acepta una propuesta bien formada', () => {
    expect(validateProposal(ok)).toBeNull();
});

test.each([
    [{ ...ok, cycleId: '' }, /cycleId/],
    [{ ...ok, cycleId: 'x'.repeat(41) }, /cycleId/],
    [{ ...ok, direction: 'sell' }, /direction/],
    [{ ...ok, quantity: 0 }, /quantity/],
    [{ ...ok, quantity: '10' }, /quantity/],
    [{ ...ok, pricePerEnergy: -1 }, /pricePerEnergy/],
    [undefined, /body/],
])('validateProposal rechaza %j', (body, msg) => {
    expect(validateProposal(body)).toMatch(msg);
});

test('una operación recién pedida (requested) se expone como proposed', () => {
    expect(toNegotiation({ id: '1', status: 'requested', quantity: '5', pricePerEnergy: '1.5' }))
        .toMatchObject({ id: 1, status: 'proposed', quantity: 5, pricePerEnergy: 1.5 });
});

test('una operación liquidada expone el precio de la central, la confirmación y el pago (U6)', () => {
    const confirmedAt = new Date('2026-09-27T12:00:05Z');
    const paidAt = new Date('2026-09-27T12:00:07Z');
    expect(toNegotiation({
        id: '2', status: 'settled', origin: 'auto', attempts: 2, quantity: '200', pricePerEnergy: '220.50',
        confirmation: { data: { energy: 200, pricePerEnergy: 220.5 } }, confirmedAt, paidAt,
    })).toMatchObject({
        status: 'paid', origin: 'auto', attempts: 2, pricePerEnergy: 220.5, settledPricePerEnergy: 220.5, confirmedAt, paidAt, failureReason: null,
    });
});

test.each([
    ['rejected', 'PRICE_ABOVE_CAP', 'rejected'],
    ['abandoned', 'TIMEOUT', 'expired'],
])('una operación %s se expone como %s con su motivo', (internal, reason, status) => {
    expect(toNegotiation({ id: '3', status: internal, failureReason: reason, failureDetail: 'detalle' }))
        .toMatchObject({ status, failureReason: reason, failureDetail: 'detalle', settledPricePerEnergy: null, paidAt: null });
});

test('POST registra la intención con attempts = 0: todavía no hubo ningún envío', async () => {
    Cycle.findByPk.mockResolvedValue({ phase: 'negotiating', windowClosesAt: new Date(Date.now() + 60000) });
    PendingOperation.create.mockImplementation(async (values) => ({ reload: async () => ({ id: '7', ...values }) }));
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

    await createNegotiation({ body: ok }, res);

    expect(PendingOperation.create).toHaveBeenCalledWith(expect.objectContaining({ status: 'requested', attempts: 0 }));
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ status: 'proposed', attempts: 0 }));
});
