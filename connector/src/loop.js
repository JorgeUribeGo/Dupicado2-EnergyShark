// Loop periódico sin solapamiento: el siguiente tick se agenda recién cuando termina el anterior.
// Con setInterval, un tick lento (DB o broker lentos) se encimaría con el siguiente y, en el
// outbox, publicaría dos veces la misma fila. Un error en un tick se loguea y el loop sigue.
// Devuelve stop(), que espera a que termine el tick en curso.
function startLoop(name, tick, intervalMs) {
    let stopped = false;
    let timer = null;
    let inFlight = Promise.resolve();

    const run = () => {
        inFlight = Promise.resolve()
            .then(tick)
            .catch((err) => console.error(`[${name}] error en el tick: ${err.message}`))
            .then(() => {
                if (!stopped) timer = setTimeout(run, intervalMs);
            });
    };
    timer = setTimeout(run, 0);

    return async function stop() {
        stopped = true;
        clearTimeout(timer);
        await inFlight;
    };
}

module.exports = { startLoop };
