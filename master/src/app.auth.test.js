// El middleware JWT de app.js contra un "Auth0" local (discovery + JWKS) con una llave RSA propia.
const http = require('http');
const crypto = require('crypto');

jest.mock('./models', () => ({ RejectedMessage: { findAndCountAll: jest.fn().mockResolvedValue({ count: 0, rows: [] }) } }));

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
const AUDIENCE = 'https://api.energyshark.test';
let idp;
let api;
let issuer;
let base;

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function sign(claims, key = privateKey) {
    const now = Math.floor(Date.now() / 1000);
    const data = `${b64({ alg: 'RS256', typ: 'JWT', kid: 'k1' })}.${b64({ iss: issuer, aud: AUDIENCE, sub: 'auth0|test', iat: now, exp: now + 60, ...claims })}`;
    return `${data}.${crypto.sign('sha256', Buffer.from(data), key).toString('base64url')}`;
}
const get = (path, token) => fetch(base + path, token ? { headers: { Authorization: `Bearer ${token}` } } : {});

beforeAll(async () => {
    idp = http.createServer((req, res) => {
        res.setHeader('Content-Type', 'application/json');
        if (req.url === '/.well-known/openid-configuration') res.end(JSON.stringify({ issuer, jwks_uri: `${issuer}.well-known/jwks.json` }));
        else res.end(JSON.stringify({ keys: [jwk] }));
    });
    await new Promise((r) => idp.listen(0, r));
    issuer = `http://localhost:${idp.address().port}/`;
    process.env.AUTH0_ISSUER_BASE_URL = issuer;
    process.env.AUTH0_AUDIENCE = AUDIENCE;
    api = require('./app').listen(0);
    await new Promise((r) => api.once('listening', r));
    base = `http://localhost:${api.address().port}`;
});
afterAll(() => { api.close(); idp.close(); });

test('/health no pide token', async () => {
    expect((await get('/health')).status).toBe(200);
});

test('sin token, la API responde 401', async () => {
    const res = await get('/api/messages/rejected');
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toMatch(/^Bearer/);
});

test('con token válido de nuestro Auth0 y audience, pasa', async () => {
    expect((await get('/api/messages/rejected', sign({}))).status).toBe(200);
});

test.each([
    ['otra audience', () => sign({ aud: 'https://otra.api' })],
    ['vencido', () => sign({ exp: Math.floor(Date.now() / 1000) - 10 })],
    ['firmado con otra llave', () => sign({}, crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey)],
])('token %s → 401', async (_, token) => {
    expect((await get('/api/messages/rejected', token())).status).toBe(401);
});

test('en producción sin configuración no arranca', () => {
    jest.isolateModules(() => {
        const saved = { ...process.env };
        delete process.env.AUTH0_ISSUER_BASE_URL;
        process.env.NODE_ENV = 'production';
        try {
            expect(() => require('./app')).toThrow(/AUTH0_ISSUER_BASE_URL/);
        } finally {
            process.env = saved;
        }
    });
});
