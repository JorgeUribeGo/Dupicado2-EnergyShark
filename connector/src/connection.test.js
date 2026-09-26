const { EventEmitter } = require('events');

jest.mock('amqplib', () => ({ connect: jest.fn() }));
jest.mock('./config', () => ({
    rabbitmq: { url: 'amqps://test' },
    reconnect: { initialDelayMs: 1000, maxDelayMs: 30000 },
}));

const amqp = require('amqplib');
const { connectWithRetry } = require('./connection');

function fakeConnection() {
    const conn = new EventEmitter();
    conn.close = jest.fn(async () => conn.emit('close'));
    return conn;
}

describe('connectWithRetry (un único loop dueño de la conexión)', () => {
    let connections;

    beforeEach(() => {
        jest.useFakeTimers();
        jest.spyOn(console, 'log').mockImplementation(() => {});
        jest.spyOn(console, 'warn').mockImplementation(() => {});
        jest.spyOn(console, 'error').mockImplementation(() => {});
        connections = [];
        amqp.connect.mockReset().mockImplementation(async () => {
            const conn = fakeConnection();
            connections.push(conn);
            return conn;
        });
    });
    afterEach(() => {
        jest.useRealTimers();
        jest.restoreAllMocks();
    });

    test('conecta y entrega la conexión; al cerrarse reconecta una sola vez, tras la espera', async () => {
        const onConnected = jest.fn();
        connectWithRetry(onConnected);
        await jest.advanceTimersByTimeAsync(0);
        expect(onConnected).toHaveBeenCalledWith(connections[0]);

        connections[0].emit('close');
        await jest.advanceTimersByTimeAsync(999);
        expect(amqp.connect).toHaveBeenCalledTimes(1);
        await jest.advanceTimersByTimeAsync(1);
        expect(amqp.connect).toHaveBeenCalledTimes(2);
        expect(onConnected).toHaveBeenLastCalledWith(connections[1]);
    });

    test('si la suscripción falla, cierra esa conexión y su close no abre un segundo loop', async () => {
        const onConnected = jest.fn()
            .mockRejectedValueOnce(new Error('404 NOT_FOUND - no queue'))
            .mockResolvedValue(undefined);
        connectWithRetry(onConnected);
        await jest.advanceTimersByTimeAsync(0);

        expect(connections[0].close).toHaveBeenCalled(); // no queda viva y sin dueño
        await jest.advanceTimersByTimeAsync(1000);
        expect(amqp.connect).toHaveBeenCalledTimes(2);

        // Antes: el close de la conexión fallida disparaba otra reconexión en paralelo.
        await jest.advanceTimersByTimeAsync(60000);
        expect(amqp.connect).toHaveBeenCalledTimes(2);
    });

    test('si el broker no responde, la espera crece 1, 2, 4, 8, 16 y se topa en 30 s', async () => {
        amqp.connect.mockRejectedValue(new Error('ECONNREFUSED'));
        connectWithRetry(jest.fn());
        await jest.advanceTimersByTimeAsync(0);

        const waits = [1000, 2000, 4000, 8000, 16000, 30000, 30000];
        for (const [i, wait] of waits.entries()) {
            await jest.advanceTimersByTimeAsync(wait - 1);
            expect(amqp.connect).toHaveBeenCalledTimes(i + 1);
            await jest.advanceTimersByTimeAsync(1);
            expect(amqp.connect).toHaveBeenCalledTimes(i + 2);
        }
    });

    test('una conexión efímera no resetea la espera (sin loop de conexiones contra el broker)', async () => {
        connectWithRetry(jest.fn());
        await jest.advanceTimersByTimeAsync(0);

        // Tres conexiones que el broker corta apenas suscritas: 1 s, 2 s, 4 s entre intentos.
        for (const wait of [1000, 2000, 4000]) {
            connections[connections.length - 1].emit('close');
            await jest.advanceTimersByTimeAsync(wait - 1);
            const before = amqp.connect.mock.calls.length;
            await jest.advanceTimersByTimeAsync(1);
            expect(amqp.connect).toHaveBeenCalledTimes(before + 1);
        }
    });

    test('una conexión que duró al menos 30 s vuelve a la espera inicial de 1 s', async () => {
        connectWithRetry(jest.fn());
        await jest.advanceTimersByTimeAsync(0);
        connections[0].emit('close');
        await jest.advanceTimersByTimeAsync(1000); // conexión 2 (la espera ya subió a 2 s)

        await jest.advanceTimersByTimeAsync(30000); // la conexión 2 fue estable
        connections[1].emit('close');
        await jest.advanceTimersByTimeAsync(1000);
        expect(amqp.connect).toHaveBeenCalledTimes(3);
    });
});
