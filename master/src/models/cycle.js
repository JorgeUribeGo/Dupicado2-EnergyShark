'use strict';
const { Model } = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  // Solo lectura desde master: quien escribe es connector (pg crudo, ADR-001).
  class Cycle extends Model {
    static associate(models) {
      Cycle.hasMany(models.LedgerEvent, { foreignKey: 'cycleId', as: 'ledgerEvents' });
      Cycle.hasMany(models.PendingOperation, { foreignKey: 'cycleId', as: 'negotiations', constraints: false });
    }
  }
  Cycle.init({
    cycleId: { type: DataTypes.STRING(40), primaryKey: true },
    phase: DataTypes.STRING(20),
    windowOpensAt: DataTypes.DATE,
    windowClosesAt: DataTypes.DATE,
    reportDueAt: DataTypes.DATE,
    statusStatement: DataTypes.JSONB,
    negotiationReport: DataTypes.JSONB,
    createdAt: DataTypes.DATE,
  }, {
    sequelize,
    modelName: 'Cycle',
    tableName: 'cycles',
    underscored: true,
    timestamps: false,
  });
  return Cycle;
};
