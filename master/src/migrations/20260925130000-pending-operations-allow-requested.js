'use strict';
// U10 (ADR-003, addendum 2026-09-25): una operación creada desde la API nace en status 'requested',
// sin envío ni timer todavía; el sweeper de U6 completa estos campos al publicarla.
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.changeColumn('pending_operations', 'last_msg_id', { type: Sequelize.UUID, allowNull: true });
    await queryInterface.changeColumn('pending_operations', 'expires_at', { type: Sequelize.DATE, allowNull: true });
  },
  async down(queryInterface, Sequelize) {
    await queryInterface.changeColumn('pending_operations', 'last_msg_id', { type: Sequelize.UUID, allowNull: false });
    await queryInterface.changeColumn('pending_operations', 'expires_at', { type: Sequelize.DATE, allowNull: false });
  },
};
