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
    status: DataTypes.STRING(30),
    lastMsgId: DataTypes.UUID,
    attempts: DataTypes.INTEGER,
    expiresAt: DataTypes.DATE,
    // U6 (ADR-003, addendum U6)
    origin: DataTypes.STRING(10),
    confirmation: DataTypes.JSONB,
    confirmations: DataTypes.JSONB,
    confirmedAt: DataTypes.DATE,
    paidAt: DataTypes.DATE,
    failureReason: DataTypes.STRING(40),
    failureDetail: DataTypes.TEXT,
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
