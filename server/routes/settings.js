'use strict';

const express = require('express');
const { httpError } = require('../utils');

module.exports = (context) => {
  const { settings } = context;
  const router = express.Router();

  router.get('/', (req, res) => {
    res.json({ settings: settings.get(), defaults: settings.defaults });
  });

  router.patch('/', (req, res) => {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      throw httpError(400, '设置内容格式错误');
    }
    res.json({ settings: settings.update(req.body) });
  });

  return router;
};
