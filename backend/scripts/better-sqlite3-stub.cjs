/**
 * Stub: en el host Android no existe el addon nativo.
 * El driver real es sql.js (LC_DB_DRIVER=sqljs).
 */
module.exports = function BetterSqlite3Unavailable() {
  throw new Error(
    "better-sqlite3 no está disponible en Android. Usa LC_DB_DRIVER=sqljs.",
  );
};
