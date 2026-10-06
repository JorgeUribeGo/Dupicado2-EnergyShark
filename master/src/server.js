require('dotenv').config();
// APM (G07/RNF05): el agente tiene que cargarse antes que express para instrumentarlo. Sin licencia
// (local, tests) no se carga y la app corre igual.
if (process.env.NEW_RELIC_LICENSE_KEY) require('newrelic');
const app = require('./app');

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Master escuchando en puerto ${PORT}`);
});
