'use strict';
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('rejected_messages', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.BIGINT,
      },
      kind: {
        type: Sequelize.STRING(20),
        allowNull: false,
      },
      msg_type: {
        type: Sequelize.STRING(40),
      },
      idpk: {
        type: Sequelize.UUID,
      },
      msg_id: {
        type: Sequelize.UUID,
      },
      reason: {
        type: Sequelize.STRING(40),
      },
      code: {
        type: Sequelize.INTEGER,
      },
      detail: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      occurred_at: {
        type: Sequelize.DATE,
        allowNull: false,
        // Sequelize.NOW es un default de nivel aplicación (solo se aplica al insertar vía
        // modelos Sequelize) y NO genera "DEFAULT now()" en la DDL real de Postgres —
        // verificado empíricamente al migrar contra una DB de prueba. connector inserta con
        // pg crudo (sin pasar por modelos), así que el default tiene que vivir en la DB.
        defaultValue: Sequelize.literal('now()'),
      },
    });
  },
  async down(queryInterface) {
    await queryInterface.dropTable('rejected_messages');
  },
};
