// Central simulada para ensayar las anomalías en LOCAL (docs/demo-anomalias.md). Nunca contra el broker del curso.
// Uso: NODE_PATH=connector/node_modules node scripts/demo/central.js <comando> [args]
//   setup                         crea exchange central.x, cola city.TEST.q y cola central.q (lo que sale del nodo)
//   send <type> <json data> [cycleId] [idpk]   publica un mensaje de la central a city.TEST.q
//   raw <texto>                   publica bytes crudos (malformado)
//   drain                         lee y resume lo que publicó el nodo
const amqp = require('amqplib');
const { randomUUID } = require('crypto');

const URL = process.env.DEMO_AMQP_URL || 'amqp://city.TEST:demo@127.0.0.1:5672/%2F';

async function main() {
    const [cmd, ...args] = process.argv.slice(2);
    const conn = await amqp.connect(URL);
    const ch = await conn.createChannel();
    if (cmd === 'setup') {
        await ch.assertExchange('central.x', 'direct', { durable: true });
        await ch.assertQueue('central.q', { durable: true });
        await ch.bindQueue('central.q', 'central.x', 'central');
        await ch.assertQueue('city.TEST.q', { durable: true });
        console.log('topología lista');
    } else if (cmd === 'send') {
        const [type, data, cycleId, idpk] = args;
        const msg = { idpk: idpk || randomUUID(), msgId: randomUUID(), type, timestamp: new Date().toISOString(), sender: 'central', ...(cycleId ? { cycleId } : {}), data: JSON.parse(data) };
        if (type === 'distance-table') msg.cityId = 'TEST';
        ch.sendToQueue('city.TEST.q', Buffer.from(JSON.stringify(msg)), { persistent: true });
        console.log(JSON.stringify({ sent: type, idpk: msg.idpk, msgId: msg.msgId }));
    } else if (cmd === 'raw') {
        ch.sendToQueue('city.TEST.q', Buffer.from(args.join(' ')), { persistent: true });
        console.log('raw enviado');
    } else if (cmd === 'drain') {
        const out = [];
        for (;;) {
            const m = await ch.get('central.q', { noAck: true });
            if (!m) break;
            const b = JSON.parse(m.content.toString());
            out.push(`${b.type}${b.reason ? ' ' + b.reason : ''}${b.data && b.data.ask ? ' ask=' + b.data.ask : ''}${b.data && b.data.target ? ' target=' + b.data.target.slice(0, 8) : ''}${b.type === 'negotiation-report' ? ' ' + JSON.stringify(b.data) : ''} user_id=${m.properties.userId}`);
        }
        console.log(out.join('\n') || '(nada)');
    }
    await new Promise((r) => setTimeout(r, 300));
    await conn.close();
}
main().catch((e) => { console.error(e.message); process.exit(1); });
