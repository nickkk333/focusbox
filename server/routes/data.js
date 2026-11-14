'use strict';

const express = require('express');

module.exports = (context) => {
  const { backup } = context;
  const router = express.Router();

  router.get('/export', (req, res) => {
    const payload = backup.snapshot();
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="focusbox-backup-${stamp}.json"`);
    res.send(JSON.stringify(payload, null, 2));
  });

  router.post('/import', (req, res) => {
    res.json(backup.restore(req.body));
  });

  router.post('/reset', (req, res) => {
    res.json(backup.reset());
  });

  return router;
};
