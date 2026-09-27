'use strict';
const { Model } = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class RejectedMessage extends Model {}
  RejectedMessage.init({
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    kind: DataTypes.STRING(20), // duplicate | nack | discarded
    msgType: DataTypes.STRING(40),
    idpk: DataTypes.UUID,
    msgId: DataTypes.UUID,
    reason: DataTypes.STRING(40),
    code: DataTypes.INTEGER,
    detail: DataTypes.TEXT,
    occurredAt: DataTypes.DATE,
  }, {
    sequelize,
    modelName: 'RejectedMessage',
    tableName: 'rejected_messages',
    underscored: true,
    timestamps: false,
  });
  return RejectedMessage;
};
