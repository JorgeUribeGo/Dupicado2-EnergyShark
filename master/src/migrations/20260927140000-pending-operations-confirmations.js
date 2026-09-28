'use strict';
// U6 (ADR-003, addendum U6, nota posterior): un pago (transfer.becauseOf) puede nombrar cualquiera de
// las confirmaciones recibidas, y hay que liquidarlo con la energía y el precio de ESA, no de la
// última. confirmation_msg_ids solo guardaba los msgId; confirmations guarda cada envelope completo,
// con su msgId como clave.
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('pending_operations', 'confirmations', {
      type: Sequelize.JSONB,
      allowNull: false,
      defaultValue: Sequelize.literal("'{}'::jsonb"),
    });
    // De las filas previas solo se conserva el envelope de la última confirmación.
    await queryInterface.sequelize.query(
      `UPDATE pending_operations SET confirmations = jsonb_build_object(confirmation->>'msgId', confirmation)
       WHERE confirmation IS NOT NULL`,
    );
    await queryInterface.removeColumn('pending_operations', 'confirmation_msg_ids');
  },
  async down(queryInterface, Sequelize) {
    await queryInterface.addColumn('pending_operations', 'confirmation_msg_ids', {
      type: Sequelize.ARRAY(Sequelize.UUID),
      allowNull: false,
      defaultValue: Sequelize.literal("'{}'::uuid[]"),
    });
    await queryInterface.sequelize.query(
      'UPDATE pending_operations SET confirmation_msg_ids = ARRAY(SELECT jsonb_object_keys(confirmations))::uuid[]',
    );
    await queryInterface.removeColumn('pending_operations', 'confirmations');
  },
};
