// config se evalúa al cargarse: cada caso lo carga de nuevo con su CYCLE_TIME_SCALE.
function loadWithTimeScale(value) {
    const previous = process.env.CYCLE_TIME_SCALE;
    process.env.CYCLE_TIME_SCALE = value;
    try {
        let config;
        jest.isolateModules(() => { config = require('./config'); });
        return config;
    } finally {
        if (previous === undefined) delete process.env.CYCLE_TIME_SCALE;
        else process.env.CYCLE_TIME_SCALE = previous;
    }
}

describe('CYCLE_TIME_SCALE', () => {
    afterEach(() => jest.restoreAllMocks());

    test('un número positivo divide las duraciones del protocolo', () => {
        const config = loadWithTimeScale('60');
        expect(config.cycle.timeScale).toBe(60);
        expect(config.cycle.negotiationWindowMs).toBe(20 * 1000);
        expect(config.negotiation.timeoutMs).toBe(500);
    });

    test('vacío: escala 1, sin aviso', () => {
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
        expect(loadWithTimeScale('').cycle.timeScale).toBe(1);
        expect(warn).not.toHaveBeenCalled();
    });

    test.each(['-1', '0', 'Infinity', 'abc'])('%s no es válido: escala 1 y aviso en el log', (value) => {
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
        const config = loadWithTimeScale(value);
        expect(config.cycle.timeScale).toBe(1);
        expect(config.scheduler.tickMs).toBe(30 * 1000);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining(`CYCLE_TIME_SCALE=${value}`));
    });
});
