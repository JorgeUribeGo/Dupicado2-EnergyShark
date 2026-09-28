const express = require('express');
const eventsRouter = require('./routes/events');
const historyRouter = require('./routes/history');
const cyclesRouter = require('./routes/cycles');
const messagesRouter = require('./routes/messages');
const negotiationsRouter = require('./routes/negotiations');

const app = express();

app.use(express.json());
app.use('/events', eventsRouter);
app.use('/history', historyRouter);
app.use('/api/cycles', cyclesRouter);
app.use('/api/messages', messagesRouter);
app.use('/api/negotiations', negotiationsRouter);

app.get('/health', (req, res) => res.status(200).send('ok'));

// Errores de Express (p. ej. body JSON inválido) como JSON, sin stack trace.
app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'Error interno del servidor' : err.message });
});

module.exports = app;