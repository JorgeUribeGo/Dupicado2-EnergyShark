'use strict';
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('ledger_events', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.BIGINT,
      },
      cycle_id: {
        type: Sequelize.STRING(40),
        allowNull: false,
        references: { model: 'cycles', key: 'cycle_id' },
      },
      type: {
        type: Sequelize.STRING(40), // transfer | demand-statement | give | take
        allowNull: false,
      },
      // UNIQUE: última línea de defensa de AD3 — una operación nunca se aplica dos veces.
      idpk: {
        type: Sequelize.UUID,
        allowNull: false,
        unique: true,
      },
      msg_id: {
        type: Sequelize.UUID,
        allowNull: false,
      },
      payload: {
        type: Sequelize.JSONB,
        allowNull: false,
      },
      delta_budget: {
        type: Sequelize.DECIMAL,
        allowNull: false,
        defaultValue: 0,
      },
      delta_energy: {
        type: Sequelize.DECIMAL,
        allowNull: false,
        defaultValue: 0,
      },
      resulting_budget: {
        type: Sequelize.DECIMAL,
        allowNull: false,
      },
      resulting_energy: {
        type: Sequelize.DECIMAL,
        allowNull: false,
      },
      applied_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('now()'),
      },
    });
    await queryInterface.addIndex('ledger_events', ['cycle_id', 'applied_at'], { name: 'ledger_events_cycle_idx' });
  },
  async down(queryInterface) {
    await queryInterface.dropTable('ledger_events');
  },
};
