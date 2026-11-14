'use strict';

const { createSettingsStore } = require('./domain/settings');
const { createOverview } = require('./domain/overview');
const { createBackup } = require('./domain/backup');
const { createAuth } = require('./auth');
const { createSeeder } = require('./seed');

// 唯一的组装点：所有模块都在这里拿到依赖，彼此不直接耦合。
function createContext({ config, database }) {
  const { db, tx } = database;
  const settings = createSettingsStore({ db, tx });
  const overview = createOverview({ db });
  const seed = createSeeder({ db, tx, settings });
  const auth = createAuth({ db, config });
  const backup = createBackup({ db, tx, settings, seed });

  return { config, db, tx, settings, overview, backup, auth, seed, database };
}

module.exports = { createContext };
