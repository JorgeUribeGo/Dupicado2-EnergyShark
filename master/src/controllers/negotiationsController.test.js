const { validateProposal, toNegotiation } = require('./negotiationsController');

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
