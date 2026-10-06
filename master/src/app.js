const express = require('express');
const { auth } = require('express-oauth2-jwt-bearer');
const eventsRouter = require('./routes/events');
const historyRouter = require('./routes/history');
const cyclesRouter = require('./routes/cycles');
const messagesRouter = require('./routes/messages');
const negotiationsRouter = require('./routes/negotiations');

const app = express();

// JWT de Auth0 también aquí, no solo en el Gateway: tiburonshark.me llega por Nginx sin pasar por él
// (decisiones fundacionales §1, addendum #15). Falla cerrado en producción.
function requireAuth({ AUTH0_ISSUER_BASE_URL: issuerBaseURL, AUTH0_AUDIENCE: audience, NODE_ENV } = process.env) {
  if (issuerBaseURL && audience) return auth({ issuerBaseURL, audience });
  if (NODE_ENV === 'production') throw new Error('Faltan AUTH0_ISSUER_BASE_URL y AUTH0_AUDIENCE en master/.env: la API no arranca sin autenticación');
  console.warn('[auth] sin AUTH0_ISSUER_BASE_URL/AUTH0_AUDIENCE: API SIN autenticación (solo local)');
  return (req, res, next) => next();
}

app.use(express.json());
// Sin token: el healthcheck de Docker y Nginx.
app.get('/health', (req, res) => res.status(200).send('ok'));
app.use(requireAuth());
app.use('/events', eventsRouter);
app.use('/history', historyRouter);
app.use('/api/cycles', cyclesRouter);
app.use('/api/messages', messagesRouter);
app.use('/api/negotiations', negotiationsRouter);

// Errores de Express (p. ej. body JSON inválido) como JSON, sin stack trace.
app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  if (err.headers) res.set(err.headers); // WWW-Authenticate de un 401 del middleware JWT
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'Error interno del servidor' : err.message });
});

module.exports = app;