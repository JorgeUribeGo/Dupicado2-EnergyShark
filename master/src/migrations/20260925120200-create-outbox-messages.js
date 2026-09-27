'use strict';
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('outbox_messages', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.BIGINT,
      },
      idpk: {
        type: Sequelize.UUID,
        allowNull: false,
      },
      msg_id: {
        type: Sequelize.UUID,
        allowNull: false,
      },
      type: {
        type: Sequelize.STRING(40),
        allowNull: false,
      },
      payload: {
        type: Sequelize.JSONB,
        allowNull: false,
      },
      status: {
        type: Sequelize.STRING(20), // pending | sent
        allowNull: false,
        defaultValue: 'pending',
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('now()'),
      },
      sent_at: { type: Sequelize.DATE },
    });
    // Índice parcial (ADR-001): el loop del outbox solo mira las pendientes.
    await queryInterface.addIndex('outbox_messages', ['status'], {
      name: 'outbox_pending_idx',
      where: { status: 'pending' },
    });
  },
  async down(queryInterface) {
    await queryInterface.dropTable('outbox_messages');
  },
};
