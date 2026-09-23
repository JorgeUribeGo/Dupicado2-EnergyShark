# **EnergyShark — E1: Análisis y Plan de Trabajo** 

## **1. Resumen Ejecutivo** 

#### **E0 vs. E1 — qué cambia:** 

E0 era un ejercicio individual de "escuchar y guardar": un connector consumía eventos demand-set desde una cola y una API los exponía paginados. Sin negociación, sin frontend, sin auth, sin lógica de negocio real. 

E1 los transforma en **un nodo autónomo que representa una ciudad** , con un protocolo bidireccional mucho más exigente: deben responder ACK/NACK/error según reglas estrictas, validar idempotencia ( idpk vs msgId ), operar un **ciclo de 2 horas con ventana de negociación de 20 minutos** sin intervención manual (recibir status-statement , negociar con la central vía negotiation-proposal→confirmación→transfer , aplicar demandstatement , y cerrar con negotiation-report antes de que termine la ventana), y mantener su propio ledger (budget + energía) como fuente de verdad reconstruible. Sobre eso se monta una capa de infraestructura completamente nueva: separación real de frontend (SPA en S3+CloudFront) y backend (API detrás de API Gateway con autorizador JWT, deploy vía ECR), autenticación (Auth0/Cognito), monitoreo APM, y **documentación de decisiones de arquitectura escritas** **_antes_ de implementarlas** (ADRs, con orden de commits verificable en git). 

La evaluación no es solo "funciona": incluye una **demo en vivo con anomalías inducidas** (duplicados, mensajes malformados, corte del broker, caída de contenedor) más una **defensa individual** donde cualquier integrante debe poder explicar cualquier archivo del sistema. 

#### **Riesgos principales (priorizados):** 

**Complejidad del protocolo, no de la infraestructura.** El grueso del riesgo real está en la lógica fina: redondeo de precios ( round2(1.05 × generationCost) antes de multiplicar), el tope de oferta, la diferencia entre NACK (rechazo de recepción) y error (rechazo de operación, siempre precedido de ACK), el user_id AMQP obligatorio y su verificación de identidad, y la idempotencia real bajo reintentos. Son exactamente los puntos que el ayudante va a poner a prueba en la demo. 

**El ciclo autónomo de 2h+20min es difícil de validar rápido.** Si no prueban un ciclo completo temprano (con timers acelerados o un mock), no van a saber si el scheduler funciona hasta que sea tarde para corregirlo. 

#### **Infraestructura nueva sobre una base que ya era su primera vez con** 

**AWS/Docker/Nginx.** API Gateway + authorizer + Cognito/Auth0 + S3/CloudFront + ECR son piezas adicionales que nadie del equipo ha tocado según lo que hicieron en E0. Esto concentra curva de aprendizaje justo en la semana con más disponibilidad. **Coordinación Git entre 2 repos y 5 personas.** Sin un contrato de API fijado desde el día 1, frontend y backend van a bloquearse mutuamente o a divergir. 

**Deuda de documentación silenciosa.** Los ADRs deben preceder a la implementación en el historial de git — si se escriben después "porque no hubo tiempo", pierden puntaje aunque el código funcione. Es fácil que esto se posponga bajo presión. 

**La segunda semana, con menos disponibilidad, es también la semana de** 

**integración, pruebas de anomalías y ensayo de demo** — si el ciclo básico (G03) y el flujo de negociación no están sólidos para el fin de la primera semana, no va a quedar espacio real para pulir ni ensayar. 

## **2. Distribución de Trabajo y Roles** 

Tu propuesta (2 FE / 2 BE / 1 Backend+AWS) funciona bien si se ancla en un **contrato fijado el día 1** , para que nadie espere a que el otro lado termine de implementar algo real. 

#### **Backend (2 personas) — dueños de la lógica del nodo:** 

Conexión al broker (protocolo v2, ACK/NACK/error), el ledger y su persistencia, el scheduler del ciclo de negociación, el flujo completo de negotiation-proposal→confirmación→pago con timeout/reintento, aplicación de demand-statement , persistencia de distancetable , y los endpoints REST que consumen esos datos (historial, conectividad, log de duplicados/NACKs). 

#### **Frontend (2 personas) — dueños de la SPA:** 

Setup del proyecto con login (Auth0/Cognito SDK), vista de historial de ciclos, vista de conectividad ( distance-table ), interfaz de administración de negociaciones voluntarias, y vista de duplicados/descartes. Pueden arrancar el día 1 contra una API mockeada (JSON estático u OpenAPI mock) sin esperar al backend real. 

#### **Jorge (Backend + AWS) — infraestructura y puente:** 

Decisión y setup de auth (Auth0 vs Cognito) desde el día 1 porque bloquea a ambos equipos; deploy backend vía ECR+EC2 con docker-compose de producción; API Gateway con subdominio, CORS y custom authorizer; frontend en S3+CloudFront; HTTPS de ambos lados; New Relic (APM + infra); budget alerts. Apoya en backend específicamente en los puntos donde infraestructura y lógica se tocan (reconexión resiliente al broker, healthchecks) — ahí ya tienes experiencia de E0. 

#### **Para evitar cuellos de botella en Git:** 

**Día 1, antes de escribir código de negocio:** fijar en el repo de contratos (que además es requisito RDOC04) los schemas de los mensajes AMQP y el OpenAPI de la API REST interna. Frontend arranca contra ese contrato con mocks; backend lo implementa en paralelo. 

Los ADRs (AD1 topología de consumo, AD2 persistencia del ledger, AD3 manejo de timeouts) se escriben **antes** de implementar cada decisión — conviene que Jorge los redacte en borrador el día 1-2 y el equipo los valide rápido, para no bloquear el orden de commits exigido. 

Rama protegida en main , PRs con al menos 2 revisores si usan programación agéntica (el enunciado lo exige explícitamente en ese caso). 

## **3. Roadmap Funcional por Unidades Atómicas** 

Cada unidad está pensada para una sesión de programación asistida por IA (implementable y testeable de punta a punta). Marco las dependencias explícitas. 

### **Fase 0 — Contratos y decisiones (Día 1, transversal)** 

**U0.1** Schemas de mensajes AMQP (todos los tipos: request/status-statement/transfer/demand-statement/distance-table/negotiationproposal/negotiation-report/ack/nack/error/give/take) en el repo de contratos. 

**U0.2** OpenAPI de la API REST interna (endpoints que necesitará el frontend para RF01, RF02, RF04, RF05). 

**U0.3** Borradores de los 3 ADRs (AD1, AD2, AD3) — deben commitearse antes que su implementación correspondiente. 

**U0.4** Spec de la entrega + plan de milestones (RDOC02), budget alerts en AWS (I9), elección de Auth0 vs Cognito. 

### **Backend — núcleo del protocolo (dependencias en cadena)** 

**U1** Conexión al broker con protocolo v2: parseo del envelope, descarte si falta msgId , NACK si malformado, user_id AMQP correcto. _(depende de U0.1)_ 

**U2** Helper genérico de ACK/NACK/error + deduplicación por idpk . _(depende de U1)_ **U3** Modelo de persistencia del ledger (AD2): event log de operaciones, reconstruible por ciclo. _(depende de U0.3)_ 

**U4** Aplicación de status-statement + transfer al ledger. _(depende de U2, U3)_ **U5** Scheduler del ciclo (ventana de 20 min dentro de cada 2h, disparo de negotiation-report 5 min antes del cierre). **Probar con timers acelerados, no esperar 2h reales.** _(depende de U3)_ 

**U6** Flujo completo de negociación voluntaria: negotiation-proposal → give / take → transfer , con timeout de 30s y reintento con mismo idpk (AD3). Es la unidad más compleja — puede necesitar 2 sesiones. _(depende de U2, U3, U4)_ 

**U7** Aplicación de demand-statement (convención de signos). Paralelizable con U6. _(depende de U3)_ 

**U8** Recepción y persistencia de distance-table (sin transmisión real esta entrega). Independiente — buen candidato para día 2-3. _(depende de U3)_ 

**U9** Endpoints REST: historial (RF01), conectividad (RF02), log de duplicados/NACKs (RF05). _(depende de U3, U8)_ 

**U10** Endpoints REST para negociaciones voluntarias manuales (RF04). _(depende de U6)_ 

**U11** Middleware de validación JWT (JWKS de Auth0/Cognito) en la API. _(depende de I1)_ 

### **Frontend (arranca en paralelo desde el día 1, contra mocks)** 

**V1** Setup SPA + integración de login (Auth0/Cognito SDK). Sin dependencias de backend real. 

**V2** Vista de historial de ciclos (RF01) — primero contra mock, luego integración real. _(integración depende de U9)_ 

**V3** Vista de conectividad/ distance-table (RF02) — mock → real. _(integración depende de U9)_ 

**V4** Admin de negociaciones voluntarias (RF04) — mock → real. _(integración depende de U10)_ **V5** Vista de duplicados/NACKs (RF05) — mock → real. _(integración depende de U9)_ **V6** Pulido: estados de carga/error, responsive. 

### **Infraestructura (Jorge)** 

**I1** Decisión y setup de Auth0/Cognito. _(día 1-2, bloqueante para U11 y V1)_ 

**I2** Docker-compose de producción, imagen en ECR, deploy en EC2. _(depende de que U1-U2 den un backend arrancable)_ 

**I3** API Gateway con subdominio + CORS. _(depende de I2)_ 

**I4** Custom authorizer validando JWT en API Gateway. _(depende de I1, I3)_ 

**I5** HTTPS ambos lados. 

**I6** Frontend en S3+CloudFront. _(depende de un build mínimo de V1)_ 

**I7 / I8** New Relic APM + monitoreo de infraestructura. 

### **Integración (crítico para no llegar tarde)** 

**INT1 — Ciclo completo end-to-end (2h+20min) sin intervención manual.** Debe lograrse **antes de terminar la semana 1** : es la prueba de que G03 realmente funciona, y detectar bugs de timing aquí, con margen, es la diferencia entre corregir tranquilos o entrar en pánico en semana 2. 

**INT2 — Simulación manual de cada anomalía de la demo** (duplicado, malformado, corte de broker, caída de contenedor). Idealmente días 10-12. 

**INT3 — Ensayo de demo + defensa individual** , últimos días antes del 4 de octubre. 

### **Documentación (transversal, no dejar para el final)** 

**D3** AI logs actualizados por integrante, en cada sesión, no al cierre. 

**D4** Diagrama UML + guía de ambiente local + pasos de replicación de monitoreo — mejor una vez la arquitectura esté estable (fin semana 1 / inicio semana 2). 

### **Asignación temporal (hoy es jueves 17/sep, entrega domingo 4/oct)** 

#### **Semana 1 (17–23 sep, disponibilidad completa) — concentrar todo lo pesado:** 

Días 1-2: U0.1-U0.4, I1, U1, U2, U3, U8, V1 (setup+login), I2 arranca. Días 3-5: U4, U5, U6 (arranca), U7, V2/V3 contra mocks, I2 termina, I3 arranca. Días 6-7: U6 termina, U9, U10, V2/V3/V4/V5 integración real, I4, I6, **INT1 (ciclo completo) — no salir de la semana sin esto validado.** 

**Semana 2 (24 sep–4 oct, disponibilidad reducida) — integración, no desarrollo nuevo:** 

Días 8-9 (aprovechar lo que quede de fin de semana): U11, I5, I7, I8, V6, D4. 

Días 10-11: INT2 (anomalías), corrección de bugs detectados en INT1. Días 12-14: buffer para imprevistos, D3/D5 al día, revisión de ADRs y documentación (RDOC01-04). 

Últimos 1-2 días: INT3 (ensayo de demo + defensa individual), congelar cambios de features (para no caer en descuento por "atraso") y coordinar con el ayudante la fecha de demo. 

Si algo de esto se atrasa, lo primero que hay que proteger es **INT1** : sin un ciclo autónomo probado de punta a punta, todo lo demás (RF01-RF05, la demo de anomalías) se construye sobre algo que nunca se validó en condiciones reales. 

