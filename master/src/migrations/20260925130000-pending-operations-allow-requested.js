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
    // Una operación que nunca se publicó (requested, o rejected localmente desde U6) no tiene envío ni
    // timer, y no hay valor honesto que ponerle: se aborta antes de tocar el esquema.
    const [[{ count }]] = await queryInterface.sequelize.query(
      'SELECT count(*)::int AS count FROM pending_operations WHERE last_msg_id IS NULL OR expires_at IS NULL',
    );
    if (count > 0) {
      throw new Error(`no se puede revertir: ${count} fila(s) de pending_operations sin last_msg_id o expires_at `
        + '(nunca publicadas). Bórralas o espera a que se publiquen antes de volver a NOT NULL.');
    }
    await queryInterface.changeColumn('pending_operations', 'last_msg_id', { type: Sequelize.UUID, allowNull: false });
    await queryInterface.changeColumn('pending_operations', 'expires_at', { type: Sequelize.DATE, allowNull: false });
  },
};
