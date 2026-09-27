'use strict';
const { Model } = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class LedgerEvent extends Model {
    static associate(models) {
      LedgerEvent.belongsTo(models.Cycle, { foreignKey: 'cycleId', as: 'cycle' });
    }
  }
  LedgerEvent.init({
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    cycleId: DataTypes.STRING(40),
    type: DataTypes.STRING(40),
    idpk: DataTypes.UUID,
    msgId: DataTypes.UUID,
    payload: DataTypes.JSONB,
    deltaBudget: DataTypes.DECIMAL,
    deltaEnergy: DataTypes.DECIMAL,
    resultingBudget: DataTypes.DECIMAL,
    resultingEnergy: DataTypes.DECIMAL,
    appliedAt: DataTypes.DATE,
  }, {
    sequelize,
    modelName: 'LedgerEvent',
    tableName: 'ledger_events',
    underscored: true,
    timestamps: false,
  });
  return LedgerEvent;
};
