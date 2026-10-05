jest.mock('../models', () => ({ sequelize: { query: jest.fn() } }));

const { sequelize } = require('../models');
const { getDistanceTable, toDistanceTable } = require('./distanceTableController');

const distances = { HGW: { distance: 62763183, transportCost: 0.0034, enabled: true } };

test('toDistanceTable expone cityId, timestamp de la central y distances', () => {
    const sentAt = new Date('2026-10-05T12:00:00Z');
    expect(toDistanceTable({ sent_at: sentAt, payload: { cityId: 'COR', data: { distances } } }))
        .toEqual({ cityId: 'COR', updatedAt: sentAt, distances });
});

test('sin tabla recibida responde 200 con distances vacío', async () => {
    sequelize.query.mockResolvedValue([[]]);
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await getDistanceTable({}, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ cityId: null, updatedAt: null, distances: {} });
});
