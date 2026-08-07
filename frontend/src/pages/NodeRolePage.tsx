import { Button } from "../components/Button";
import { storeNodeRole, type NodeRole } from "../lib/nodeRole";

interface Props {
  onChosen: (role: NodeRole) => void;
}

export function NodeRolePage({ onChosen }: Props) {
  function pick(role: NodeRole) {
    storeNodeRole(role);
    onChosen(role);
  }

  return (
    <div className="h-full flex items-center justify-center bg-surface p-6">
      <div className="w-full max-w-lg animate-fade-up">
        <div className="mb-8 text-center">
          <p className="text-3xl font-semibold tracking-tight">¿Cómo usas esta tablet?</p>
          <p className="mt-2 text-muted text-sm leading-relaxed">
            El inventario y las ventas viven en <span className="text-ink font-medium">un solo equipo principal</span>.
            Las demás tablets de caja se conectan a él por Wi‑Fi y ven el mismo stock al instante.
          </p>
        </div>

        <div className="space-y-3">
          <Button size="lg" className="w-full min-h-28 text-left px-6" onClick={() => pick("primary")}>
            <span className="block">
              <span className="block text-lg">Esta es la principal</span>
              <span className="block text-sm font-normal opacity-80 mt-1">
                Guarda el inventario y también sirve como caja. Déjala encendida; las otras tablets se conectan a ella.
              </span>
            </span>
          </Button>
          <Button
            size="lg"
            variant="secondary"
            className="w-full min-h-28 text-left px-6"
            onClick={() => pick("client")}
          >
            <span className="block">
              <span className="block text-lg">Me conecto a otra</span>
              <span className="block text-sm font-normal text-muted mt-1">
                Caja o preparación secundaria. Usa el mismo inventario que la principal.
              </span>
            </span>
          </Button>
        </div>
      </div>
    </div>
  );
}
