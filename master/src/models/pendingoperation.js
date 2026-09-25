'use strict';
const { Model } = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class PendingOperation extends Model {}
  PendingOperation.init({
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    idpk: DataTypes.UUID,
    cycleId: DataTypes.STRING(40),
    direction: DataTypes.STRING(10),
    quantity: DataTypes.DECIMAL,
    pricePerEnergy: DataTypes.DECIMAL,
    status: DataTypes.STRING(20),
    lastMsgId: DataTypes.UUID,
    attempts: DataTypes.INTEGER,
    expiresAt: DataTypes.DATE,
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  }, {
    sequelize,
    modelName: 'PendingOperation',
    tableName: 'pending_operations',
    underscored: true,
    timestamps: false,
  });
  return PendingOperation;
};
