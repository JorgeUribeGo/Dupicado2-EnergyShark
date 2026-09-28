const { toCycleSummary } = require('./cyclesController');

const cycle = (over = {}) => ({
    cycleId: 'cycle-1', phase: 'negotiating', windowOpensAt: null, windowClosesAt: null,
    statusStatement: { idpk: 'x', data: { energy: { generationCapacity: 1000, consumption: 800, generationCost: 210 }, validUntil: 'v' } },
    negotiationReport: null,
    ...over,
});
const event = (id, type, data, deltaBudget, resultingBudget, resultingEnergy) => ({
    id, type, msgId: `m${id}`, payload: { data }, deltaBudget: String(deltaBudget),
    resultingBudget: String(resultingBudget), resultingEnergy: String(resultingEnergy), appliedAt: `t${id}`,
});

test('arma el CycleSummary de RF01 con balances finales y última operación', () => {
    const events = [
        event(1, 'transfer', { quantity: 5000 }, 5000, 5000, 0),
        event(2, 'demand-statement', { balance: { quantity: -50, valuePerKwh: 10 } }, 500, 5500, -50),
    ];
    const ops = [{ id: '3', cycleId: 'cycle-1', idpk: 'i', direction: 'give', quantity: '10', pricePerEnergy: '220.5', status: 'abandoned', createdAt: 'c' }];
    const s = toCycleSummary(cycle({ negotiationReport: { timestamp: 'r', data: { budgetBalance: 5500, energyBalance: 150 } } }), events, ops);

    expect(s.statusStatement.energy.generationCost).toBe(210);
    expect(s.transfersReceived).toEqual([{ msgId: 'm1', quantity: 5000, becauseOf: null, receivedAt: 't1' }]);
    expect(s.demandStatementsApplied).toEqual([{ msgId: 'm2', quantity: -50, valuePerKwh: 10, appliedAt: 't2' }]);
    expect(s.voluntaryNegotiations[0]).toMatchObject({ id: 3, quantity: 10, pricePerEnergy: 220.5, status: 'expired' });
    expect(s.negotiationReportSent).toEqual({ budgetBalance: 5500, energyBalance: 150, sentAt: 'r' });
    expect(s.finalBalances).toEqual({ budget: 5500, energy: 150 });
    expect(s.lastOperationApplied).toEqual({ type: 'demand-statement', appliedAt: 't2' });
});

test('ciclo sin operaciones ni status-statement no inventa balances', () => {
    const s = toCycleSummary(cycle({ statusStatement: null }), [], []);
    expect(s.statusStatement).toBeNull();
    expect(s.finalBalances).toEqual({ budget: null, energy: null });
    expect(s.lastOperationApplied).toBeNull();
    expect(s.negotiationReportSent).toBeNull();
});
