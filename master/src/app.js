const express = require('express');
const eventsRouter = require('./routes/events');
const historyRouter = require('./routes/history');
const cyclesRouter = require('./routes/cycles');
const messagesRouter = require('./routes/messages');

const app = express();

app.use(express.json());
app.use('/events', eventsRouter);
app.use('/history', historyRouter);
app.use('/api/cycles', cyclesRouter);
app.use('/api/messages', messagesRouter);

app.get('/health', (req, res) => res.status(200).send('ok'));

module.exports = app;