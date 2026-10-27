'use strict';
const { json, authorize } = require('./_lib');
module.exports = async (req, res) => {
  const ctx = await authorize(req, res);
  if (!ctx) return;
  json(res, 200, { email: ctx.user.email, name: ctx.user.name, avatar: ctx.user.avatar, isAdmin: ctx.isAdmin, isOwner: ctx.isOwner });
};
