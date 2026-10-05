'use strict';
// Historial de todas las distance-table recibidas (ADR-002, addendum 3). UNIQUE(idpk) detecta el
// reenvío; la vigente es la de sent_at más reciente.
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('distance_tables', {
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
      msg_id: {
        type: Sequelize.UUID,
        allowNull: false,
      },
      // El schema asume cityId en este tipo, pero el enunciado no lo cierra: nullable.
      city_id: {
        type: Sequelize.STRING(40),
        allowNull: true,
      },
      // timestamp del envelope: ordena tablas que llegan fuera de orden.
      sent_at: {
        type: Sequelize.DATE,
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
    await queryInterface.addIndex('distance_tables', ['sent_at', 'id'], { name: 'distance_tables_sent_at_idx' });
  },
  async down(queryInterface) {
    await queryInterface.dropTable('distance_tables');
  },
};
