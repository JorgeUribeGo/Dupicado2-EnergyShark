require('dotenv').config();
// APM (G07/RNF05): el agente tiene que cargarse antes que express para instrumentarlo. Sin licencia
// (local, tests) no se carga y la app corre igual.
if (process.env.NEW_RELIC_LICENSE_KEY) {
  // Sin NEW_RELIC_APP_NAME (u otra config inválida) el agente no arranca y `agent` queda undefined:
  // se dice explícito en el log en vez de fallar en silencio.
  const { agent } = require('newrelic');
  if (agent) console.log(`[newrelic] APM activo app=${agent.config.applications().join(',')}`);
  else console.error('[newrelic] hay NEW_RELIC_LICENSE_KEY pero el agente APM NO arrancó (¿falta NEW_RELIC_APP_NAME?)');
} else {
  console.log('[newrelic] sin NEW_RELIC_LICENSE_KEY: APM desactivado');
}
const app = require('./app');

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Master escuchando en puerto ${PORT}`);
});
