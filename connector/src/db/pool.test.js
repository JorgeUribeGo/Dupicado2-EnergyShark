const { EventEmitter } = require('events');

// pg.Pool falso: un EventEmitter, como el real. Sin listener de 'error', emit('error') lanza.
jest.mock('pg', () => {
    const { EventEmitter: Emitter } = require('events');
    return { Pool: class extends Emitter {} };
});
jest.mock('../config', () => ({ db: { ssl: false } }));

const pool = require('./pool');

test('un cliente inactivo que pierde la conexión (Postgres cayéndose) no tumba el proceso', () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    expect(pool).toBeInstanceOf(EventEmitter);
    expect(() => pool.emit('error', new Error('Connection terminated unexpectedly'))).not.toThrow();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Connection terminated unexpectedly'));
    errorSpy.mockRestore();
});
