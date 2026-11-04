'use strict';

const express = require('express');
const { readSettings, writeSettings, SETTINGS_DEFAULTS } = require('../db');
const { httpError } = require('../utils');

const router = express.Router();

router.get('/', (req, res) => {
  res.json({ settings: readSettings(), defaults: SETTINGS_DEFAULTS });
});

router.patch('/', (req, res) => {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    throw httpError(400, '设置内容格式错误');
  }
  const settings = writeSettings(req.body);
  res.json({ settings });
});

module.exports = router;
