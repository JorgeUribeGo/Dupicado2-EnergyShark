'use strict';
// Historial de todos los status-statement aplicados (ADR-002, addendum 2): UNIQUE(idpk) detecta el
// reenvío de cualquiera de ellos, no solo del último.
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('status_statements', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.BIGINT,
      },
      idpk: {
        type: Sequelize.UUID,
        allowNull: false,
        unique: true,
      },
      // Sin FK a cycles, igual que pending_operations: una FK obligaría a cualquier TRUNCATE de
      // cycles (tests de integración) a incluir esta tabla.
      cycle_id: {
        type: Sequelize.STRING(40),
        allowNull: false,
      },
      msg_id: {
        type: Sequelize.UUID,
        allowNull: false,
      },
      payload: {
        type: Sequelize.JSONB,
        allowNull: false,
      },
      received_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('now()'),
      },
    });
    await queryInterface.addIndex('status_statements', ['cycle_id', 'received_at'], { name: 'status_statements_cycle_idx' });
  },
  async down(queryInterface) {
    await queryInterface.dropTable('status_statements');
  },
};
