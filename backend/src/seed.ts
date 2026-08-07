import { initDatabase, initSchema } from "./db.js";
import { bootstrapDefaults } from "./bootstrap.js";

await initDatabase();
initSchema();
bootstrapDefaults();

console.log("Base lista.");
console.log("- Zonas: Cocina, Coctelería, Caja");
console.log("- Ejemplos: 2 productos y 2 ingredientes (si la base estaba vacía)");
console.log("- Sin usuarios: crea el perfil administrador al primer inicio");
