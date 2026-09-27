'use strict';
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('pending_operations', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.BIGINT,
      },
      // Fijo para toda la vida de la operación: cada reintento reutiliza este idpk (ADR-003).
      idpk: {
        type: Sequelize.UUID,
        allowNull: false,
        unique: true,
      },
      cycle_id: {
        type: Sequelize.STRING(40),
        allowNull: false,
      },
      direction: {
        type: Sequelize.STRING(10), // give | take
        allowNull: false,
      },
      quantity: {
        type: Sequelize.DECIMAL,
        allowNull: false,
      },
      price_per_energy: {
        type: Sequelize.DECIMAL,
        allowNull: false,
      },
      status: {
        // awaiting_confirmation | awaiting_payment | settled | abandoned
        type: Sequelize.STRING(20),
        allowNull: false,
        defaultValue: 'awaiting_confirmation',
      },
      last_msg_id: {
        type: Sequelize.UUID,
        allowNull: false,
      },
      attempts: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 1,
      },
      expires_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('now()'),
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('now()'),
      },
    });
    await queryInterface.addIndex('pending_operations', ['status', 'expires_at'], { name: 'pending_ops_sweep_idx' });
  },
  async down(queryInterface) {
    await queryInterface.dropTable('pending_operations');
  },
};
