'use strict';
// U6 (ADR-003, addendum 2026-09-27): lo que el flujo de negociación necesita guardar además del
// timer — de dónde salió la operación, qué confirmó la central, cuándo se pagó y por qué falló.
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // 'awaiting_confirmation' tiene 21 caracteres y la columna era VARCHAR(20) (el SQL de ADR-003): la
    // primera propuesta publicada fallaba con "value too long". Nadie lo vio antes porque U10 solo
    // inserta 'requested'.
    await queryInterface.changeColumn('pending_operations', 'status', {
      type: Sequelize.STRING(30),
      allowNull: false,
      defaultValue: 'awaiting_confirmation',
    });
    // auto: la propuso el connector al llegar el status-statement | manual: la creó la API (U10).
    await queryInterface.addColumn('pending_operations', 'origin', {
      type: Sequelize.STRING(10),
      allowNull: false,
      defaultValue: 'manual',
    });
    // Última confirmación give/take recibida (envelope completo): energía y precio de liquidación.
    await queryInterface.addColumn('pending_operations', 'confirmation', { type: Sequelize.JSONB });
    // Todas las confirmaciones recibidas: un pago (transfer.becauseOf) puede apuntar a cualquiera.
    await queryInterface.addColumn('pending_operations', 'confirmation_msg_ids', {
      type: Sequelize.ARRAY(Sequelize.UUID),
      allowNull: false,
      defaultValue: Sequelize.literal("'{}'::uuid[]"),
    });
    await queryInterface.addColumn('pending_operations', 'confirmed_at', { type: Sequelize.DATE });
    await queryInterface.addColumn('pending_operations', 'paid_at', { type: Sequelize.DATE });
    // Motivo de rejected/abandoned: el reason de la central (PRICE_ABOVE_CAP, ...) o uno propio
    // (TIMEOUT, WINDOW_CLOSED, NO_STATUS_STATEMENT).
    await queryInterface.addColumn('pending_operations', 'failure_reason', { type: Sequelize.STRING(40) });
    await queryInterface.addColumn('pending_operations', 'failure_detail', { type: Sequelize.TEXT });

    // Una sola propuesta automática por ciclo, aunque llegue un status-statement de reemplazo.
    await queryInterface.addIndex('pending_operations', ['cycle_id'], {
      name: 'pending_ops_one_auto_per_cycle',
      unique: true,
      where: { origin: 'auto' },
    });
    // Correlación de una confirmación con cualquiera de los envíos de la propuesta.
    await queryInterface.addIndex('outbox_messages', ['msg_id'], { name: 'outbox_msg_id_idx' });
  },
  async down(queryInterface, Sequelize) {
    // 'awaiting_confirmation' (el estado de toda propuesta publicada) no cabe en VARCHAR(20): se aborta
    // antes de tocar el esquema, en vez de fallar a medio camino con las columnas ya borradas.
    const [[{ count }]] = await queryInterface.sequelize.query(
      'SELECT count(*)::int AS count FROM pending_operations WHERE length(status) > 20',
    );
    if (count > 0) {
      throw new Error(`no se puede revertir: ${count} fila(s) de pending_operations con un status de más de 20 `
        + "caracteres ('awaiting_confirmation'). Bórralas o espera a que terminen antes de volver a VARCHAR(20).");
    }
    await queryInterface.removeIndex('outbox_messages', 'outbox_msg_id_idx');
    await queryInterface.removeIndex('pending_operations', 'pending_ops_one_auto_per_cycle');
    for (const column of ['failure_detail', 'failure_reason', 'paid_at', 'confirmed_at', 'confirmation_msg_ids', 'confirmation', 'origin']) {
      await queryInterface.removeColumn('pending_operations', column);
    }
    await queryInterface.changeColumn('pending_operations', 'status', {
      type: Sequelize.STRING(20),
      allowNull: false,
      defaultValue: 'awaiting_confirmation',
    });
  },
};
