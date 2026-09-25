'use strict';
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('cycles', {
      cycle_id: {
        type: Sequelize.STRING(40),
        primaryKey: true,
      },
      phase: {
        type: Sequelize.STRING(20),
        allowNull: false,
        defaultValue: 'negotiating', // negotiating | consuming | closed
      },
      // Nullable: el ciclo se crea con el primer mensaje que lo nombra, y las ventanas solo se
      // conocen al llegar el status-statement (ADR-002, addendum 2026-09-25).
      window_opens_at: { type: Sequelize.DATE },
      window_closes_at: { type: Sequelize.DATE },
      report_due_at: { type: Sequelize.DATE },
      status_statement: { type: Sequelize.JSONB },
      negotiation_report: { type: Sequelize.JSONB },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        // literal('now()') y no Sequelize.NOW: connector inserta con pg crudo (ver ADR-002).
        defaultValue: Sequelize.literal('now()'),
      },
    });
    await queryInterface.addIndex('cycles', ['phase', 'report_due_at'], { name: 'cycles_phase_report_due_idx' });
  },
  async down(queryInterface) {
    await queryInterface.dropTable('cycles');
  },
};
