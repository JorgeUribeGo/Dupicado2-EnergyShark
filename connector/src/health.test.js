jest.mock('fs');

const fs = require('fs');
const health = require('./health');

describe('health (archivo del HEALTHCHECK)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.useFakeTimers();
        health.setConsuming(false);
        jest.clearAllMocks();
    });
    afterEach(() => {
        health.stop();
        jest.useRealTimers();
    });

    test('al empezar a consumir se toca el archivo de inmediato', () => {
        health.setConsuming(true);
        expect(fs.writeFileSync).toHaveBeenCalledWith('/tmp/healthy', '');
    });

    test('mientras se consume, el latido lo mantiene al día aunque no lleguen mensajes', () => {
        health.start();
        health.setConsuming(true);
        fs.writeFileSync.mockClear();

        jest.advanceTimersByTime(30000 * 4); // 2 min sin mensajes
        expect(fs.writeFileSync).toHaveBeenCalledTimes(4);
    });

    test('al perder el consumo se borra el archivo y el latido deja de tocarlo', () => {
        health.start();
        health.setConsuming(true);
        health.setConsuming(false);
        fs.writeFileSync.mockClear();

        expect(fs.unlinkSync).toHaveBeenCalledWith('/tmp/healthy');
        jest.advanceTimersByTime(30000 * 4);
        expect(fs.writeFileSync).not.toHaveBeenCalled();
    });

    test('si el archivo ya no existía, no es un error', () => {
        fs.unlinkSync.mockImplementationOnce(() => { throw Object.assign(new Error('no existe'), { code: 'ENOENT' }); });
        const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

        expect(() => health.setConsuming(false)).not.toThrow();
        expect(errorSpy).not.toHaveBeenCalled();
        errorSpy.mockRestore();
    });
});
