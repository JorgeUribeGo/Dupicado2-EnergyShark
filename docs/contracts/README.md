# EnergyShark — Repo de Contratos (E1)

Fuente única de verdad para (1) el protocolo de mensajería con la central y (2) la API REST interna
que consume el frontend. Referenciado por ambos repos (`backend`, `frontend`) como submódulo o
paquete versionado. Ver también `agents.md` (a crear) con el contexto compartido para asistentes de IA.

## ¿Por qué existen estos archivos?

El enunciado da **ejemplos de payload y descripciones en prosa**, no un schema formal. Los archivos
en `schemas/` son nuestra interpretación formalizada (JSON Schema draft-07) de esas descripciones —
no vienen "ya hechos" del curso. Úsenlos con [Ajv](https://ajv.js.org/) para validar en runtime,
no solo como documentación.

```js
const Ajv = require("ajv");
const addFormats = require("ajv-formats");
const ajv = new Ajv({ allErrors: true });
addFormats(ajv);

const envelope = require("./schemas/envelope.schema.json");
const nack = require("./schemas/messages/nack.schema.json");
ajv.addSchema(envelope, "envelope.schema.json"); // registrar antes de compilar los que hacen $ref
const validateNack = ajv.compile(nack);
```

## ⚠️ Ambigüedad a confirmar con el ayudante

`distance-table` es el único tipo donde el enunciado no deja claro si el mensaje lleva `sender` y
`cityId` a la vez. Asumimos que sí (ambos). Si el ayudante confirma lo contrario, es un cambio de
una línea en `schemas/messages/distance-table.schema.json` — pero no lo den por sentado.

## Lo que JSON Schema no puede validar por sí solo

- **`idpk` ≠ `msgId`**: no hay forma limpia de expresar "estos dos campos deben ser distintos" en
  JSON Schema puro. Se valida en código, en el mismo punto donde se decide responder `NACK` con
  `reason: IDPK_EQUALS_MSGID`.
- **`user_id` (propiedad AMQP)**: no es parte del body del mensaje, así que no vive en estos schemas.
  Se valida al publicar (opción del cliente AMQP) y la central lo compara contra el `cityId` del body.

## Tabla NACK — rechazo de RECEPCIÓN (nunca lleva `ack` previo)

| reason             | code |
|--------------------|------|
| MALFORMED_MESSAGE  | 422  |
| UNKNOWN_TYPE       | 400  |
| IDPK_EQUALS_MSGID  | 422  |
| IDENTITY_MISMATCH  | 403  |

`PRICE_ABOVE_CAP` (422) también se acepta como NACK: el enunciado dice que viaja como `error`, pero su
propio ejemplo lo muestra con `"type": "nack"`. El connector trata ambos igual (ADR-003, addendum U6 §10).

## Tabla error — rechazo de OPERACIÓN (siempre precedido de `ack`)

| reason           | code | Cuándo                                    |
|------------------|------|--------------------------------------------|
| CYCLE_UNKNOWN    | 404  | el `cycleId` nombrado no existe             |
| CYCLE_EXPIRED    | 410  | la ventana de negociación de ese ciclo ya cerró |
| PRICE_ABOVE_CAP  | 422  | el precio ofertado supera el tope del ciclo |
| OVER_CAPACITY    | 409  | el `give` excede la energía vendible restante |
| REPORT_TOO_EARLY | 425  | el `negotiation-report` llegó antes de que abriera el periodo de cierre; trae `data.opensAt` (el enunciado también lo llama 422 en un párrafo: se aceptan ambos) |

## Regla rápida NACK vs error

- **NACK**: nunca hay `ack` antes. El mensaje ni siquiera fue "entendido".
- **error**: siempre hay `ack` antes. El mensaje fue entendido; lo que falla es la operación.
- Nunca se hace ack-de-ack, nack-de-nack, ni ack/error-de-error (se evita el loop de cortesía).

## Estructura

```
contracts/
├── README.md
├── openapi.yaml                    # API REST interna (backend <-> frontend)
└── schemas/
    ├── envelope.schema.json        # campos comunes a todo mensaje
    └── messages/
        ├── request.schema.json
        ├── status-statement.schema.json
        ├── transfer.schema.json
        ├── distance-table.schema.json
        ├── demand-statement.schema.json
        ├── negotiation-proposal.schema.json
        ├── negotiation-report.schema.json
        ├── ack.schema.json
        ├── nack.schema.json
        ├── error.schema.json
        ├── give.schema.json
        └── take.schema.json
```
