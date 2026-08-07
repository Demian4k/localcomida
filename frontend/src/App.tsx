import { useCallback, useEffect, useRef, useState } from "react";
import {
  api,
  checkHealth,
  clearAuth,
  getApiBase,
  getStoredAuth,
  prepareApiStorage,
  setApiBase,
  storeAuth,
} from "./api";
import { LoginPage } from "./pages/LoginPage";
import { SetupWizard } from "./pages/SetupWizard";
import { ConnectServerPage } from "./pages/ConnectServerPage";
import {
  clearAppMode,
  getStoredAppMode,
  getStoredStationZoneId,
  ModeSelectPage,
  type AppMode,
} from "./pages/ModeSelectPage";
import { KitchenPage } from "./pages/KitchenPage";
import { PosPage } from "./pages/PosPage";
import { InventoryPage } from "./pages/InventoryPage";
import { ProductsPage } from "./pages/ProductsPage";
import { PrintersPage } from "./pages/PrintersPage";
import { BottomSheet } from "./components/BottomSheet";
import { ProfileMenu, type ProfileAction } from "./components/ProfileMenu";
import { ProfilesPanel } from "./components/ProfilesPanel";
import { StoreInfoPanel } from "./components/StoreInfoPanel";
import { SalesPanel } from "./components/SalesPanel";
import { CashClosePanel } from "./components/CashClosePanel";
import { ConnectTabletsPanel } from "./components/ConnectTabletsPanel";
import { ReadyToast } from "./components/ReadyToast";
import { isDesktopShell, isNativeMobile } from "./lib/platform";
import { useIsPhone } from "./lib/useIsPhone";
import { getStoredNodeRole, clearNodeRole, type NodeRole } from "./lib/nodeRole";
import { startEmbeddedHost, resetEmbeddedHostState } from "./lib/embeddedHost";
import { NodeRolePage } from "./pages/NodeRolePage";
import { TrialExpiredPage } from "./pages/TrialExpiredPage";
import type { AuthState, CatalogProduct, StoreSettings } from "./types";
import { ensureTrialStarted, isTrialBuild, isTrialExpired } from "./lib/trial";

type Tab = "pos" | "inventory" | "products" | "hardware";

interface SetupStatus {
  needs_admin: boolean;
  needs_store: boolean;
}

function normalizeAuth(data: AuthState): AuthState {
  return {
    ...data,
    username: data.username || `user_${data.user_id}`,
  };
}

export default function App() {
  const mobile = isNativeMobile();
  const desktop = isDesktopShell();
  const isPhone = useIsPhone();

  const [storageReady, setStorageReady] = useState(!mobile);
  const [navOpen, setNavOpen] = useState(false);
  const [nodeRole, setNodeRole] = useState<NodeRole | null>(null);
  const [hostStarting, setHostStarting] = useState(false);
  const [hostError, setHostError] = useState<string | null>(null);
  const [serverOk, setServerOk] = useState<boolean | null>(null);
  const [bootLoading, setBootLoading] = useState(true);
  const [setup, setSetup] = useState<SetupStatus | null>(null);
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [appMode, setAppMode] = useState<AppMode | null>(null);
  const [stationZoneId, setStationZoneId] = useState<number | null>(null);
  const [tab, setTab] = useState<Tab>("pos");
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [printerAlert, setPrinterAlert] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [storeName, setStoreName] = useState("LocalComida");
  const [trialExpired, setTrialExpired] = useState(false);

  const [profilesOpen, setProfilesOpen] = useState(false);
  const [storeOpen, setStoreOpen] = useState(false);
  const [salesOpen, setSalesOpen] = useState(false);
  const [cashCloseOpen, setCashCloseOpen] = useState(false);
  const [connectTabletsOpen, setConnectTabletsOpen] = useState(false);
  const probeLock = useRef(false);

  useEffect(() => {
    void (async () => {
      await prepareApiStorage();
      if (isTrialBuild()) {
        ensureTrialStarted();
        setTrialExpired(isTrialExpired());
      }
      setAuth(() => {
        const stored = getStoredAuth();
        return stored ? normalizeAuth(stored) : null;
      });
      const mode = getStoredAppMode();
      setAppMode(mode);
      setStationZoneId(getStoredStationZoneId());
      const role = getStoredNodeRole();
      // Escritorio Electron = nodo principal implícito
      if (!mobile) {
        setNodeRole(role ?? "primary");
        if (!mode) setAppMode("caja");
      } else {
        setNodeRole(role);
      }
      setStorageReady(true);
    })();
  }, [mobile]);

  const resetToInitialSetup = useCallback(() => {
    clearAuth();
    clearAppMode();
    clearNodeRole();
    resetEmbeddedHostState();
    setApiBase("");
    setAuth(null);
    setAppMode(null);
    setStationZoneId(null);
    setNodeRole(null);
    setServerOk(null);
    setSetup(null);
    setBootLoading(true);
    setHostError(null);
    setHostStarting(false);
    setProducts([]);
  }, []);

  const probeServer = useCallback(async () => {
    if (probeLock.current) return false;
    probeLock.current = true;
    try {
      if (mobile && nodeRole === "client" && !getApiBase()) {
        setServerOk(false);
        return false;
      }
      if (mobile && nodeRole === "primary") {
        setHostStarting(true);
        setHostError(null);
        const started = await startEmbeddedHost();
        setHostStarting(false);
        if (!started.ok) {
          setHostError(started.error ?? "No se pudo iniciar el servidor");
          setServerOk(false);
          return false;
        }
      }
      // Timeout corto: si la IP guardada no responde (otra red / datos móviles), no colgar.
      const ok = await checkHealth(getApiBase(), 3000);
      setServerOk(ok);
      return ok;
    } finally {
      probeLock.current = false;
    }
  }, [mobile, nodeRole]);

  useEffect(() => {
    if (!storageReady) return;
    if (mobile && !nodeRole) return;
    if (mobile && !appMode) return;
    void probeServer();
  }, [storageReady, mobile, nodeRole, appMode, probeServer]);

  const refreshSetup = useCallback(async () => {
    const status = await api<SetupStatus>("/auth/setup-status");
    setSetup(status);
    return status;
  }, []);

  useEffect(() => {
    if (serverOk !== true) return;
    void refreshSetup()
      .catch(() => setSetup({ needs_admin: false, needs_store: false }))
      .finally(() => setBootLoading(false));
  }, [serverOk, refreshSetup]);

  const enterApp = useCallback((data: AuthState) => {
    const normalized = normalizeAuth(data);
    storeAuth(normalized);
    setAuth(normalized);
    setSetup({ needs_admin: false, needs_store: false });
    setTab("pos");
  }, []);

  const handleLogin = useCallback(
    async (data: AuthState) => {
      const normalized = normalizeAuth(data);
      storeAuth(normalized);
      setAuth(normalized);
      setTab("pos");
      await refreshSetup().catch(() => null);
    },
    [refreshSetup],
  );

  const logout = useCallback(() => {
    clearAuth();
    setAuth(null);
    setProducts([]);
  }, []);

  const loadCatalog = useCallback(async () => {
    const data = await api<CatalogProduct[]>("/catalog/products");
    setProducts(data);
  }, []);

  const appReady =
    Boolean(auth) &&
    setup !== null &&
    !setup.needs_admin &&
    !setup.needs_store &&
    appMode === "caja";

  useEffect(() => {
    if (!appReady || !auth) return;
    void loadCatalog().catch((err: unknown) => {
      setLoadError(err instanceof Error ? err.message : "No se pudo cargar el menú");
      if (
        err &&
        typeof err === "object" &&
        "status" in err &&
        (err as { status: number }).status === 401
      ) {
        logout();
      }
    });
    void api<StoreSettings>("/settings/store")
      .then((s) => setStoreName(s.name || "LocalComida"))
      .catch(() => undefined);
  }, [appReady, auth, loadCatalog, logout]);

  useEffect(() => {
    if (!appReady || !auth) return;
    const id = window.setInterval(() => {
      void api<{ alerts: { message: string }[] }>("/hardware/print-queue")
        .then((q) => {
          setPrinterAlert(q?.alerts?.[0]?.message ?? null);
        })
        .catch(() => undefined);
    }, 2500);
    return () => window.clearInterval(id);
  }, [appReady, auth]);

  function onProfileAction(action: ProfileAction) {
    if (action === "logout") {
      logout();
      return;
    }
    if (action === "profiles") setProfilesOpen(true);
    if (action === "store") setStoreOpen(true);
    if (action === "sales") setSalesOpen(true);
    if (action === "cash-close") setCashCloseOpen(true);
    if (action === "connect-tablets") setConnectTabletsOpen(true);
  }

  if (!storageReady) {
    return (
      <div className="h-full flex items-center justify-center bg-surface text-muted">
        Iniciando…
      </div>
    );
  }

  if (isTrialBuild() && trialExpired) {
    return <TrialExpiredPage />;
  }

  // Móvil: Principal vs cliente (inventario único en el principal)
  if (mobile && !nodeRole) {
    return <NodeRolePage onChosen={(role) => setNodeRole(role)} />;
  }

  // Móvil: Modo → luego conectar o arrancar host
  if (mobile && !appMode) {
    return (
      <ModeSelectPage
        modeOnly
        onChosen={(mode) => {
          setAppMode(mode);
          setStationZoneId(null);
        }}
      />
    );
  }

  if (hostStarting) {
    return (
      <div className="h-full flex flex-col items-center justify-center bg-surface text-muted p-6 text-center gap-3">
        <p className="text-lg text-ink font-medium">Arrancando el servidor en esta tablet…</p>
        <p className="text-sm max-w-sm">
          Puede tardar hasta un minuto la primera vez. Si la app se cierra sola, este dispositivo no
          soporta el servidor embebido: usa un PC como principal o «Me conecto a otra».
        </p>
        <button
          type="button"
          className="mt-4 min-h-12 px-6 rounded-2xl text-sm text-muted hover:text-ink"
          onClick={resetToInitialSetup}
        >
          ← Cancelar y volver
        </button>
      </div>
    );
  }

  if (serverOk === null) {
    return (
      <div className="h-full flex flex-col items-center justify-center bg-surface text-muted p-6 gap-4 text-center">
        <p>Conectando…</p>
        <p className="text-sm max-w-xs">
          Si cambiaste de red (Wi‑Fi ↔ datos), esto no debería tardar más de unos segundos.
        </p>
        <button
          type="button"
          className="min-h-12 px-6 rounded-2xl text-sm text-ink border border-border bg-white"
          onClick={() => {
            setServerOk(false);
          }}
        >
          Cancelar y elegir cómo conectar
        </button>
        {mobile ? (
          <button
            type="button"
            className="min-h-11 text-sm text-muted"
            onClick={resetToInitialSetup}
          >
            ← Volver a la configuración inicial
          </button>
        ) : null}
      </div>
    );
  }

  if (serverOk === false) {
    if (nodeRole === "primary") {
      return (
        <div className="h-full flex items-center justify-center bg-surface p-6">
          <div className="w-full max-w-md bg-white rounded-[2rem] border border-border p-6 space-y-4 text-center">
            <p className="text-xl font-semibold">No se pudo iniciar el servidor</p>
            <p className="text-sm text-muted">{hostError ?? "Revisa permisos de red y vuelve a intentar."}</p>
            <button
              type="button"
              className="w-full min-h-12 rounded-2xl bg-ink text-white font-medium"
              onClick={() => {
                resetEmbeddedHostState();
                setServerOk(null);
                void probeServer();
              }}
            >
              Reintentar
            </button>
            <button
              type="button"
              className="w-full min-h-12 text-sm text-muted"
              onClick={resetToInitialSetup}
            >
              ← Volver a la configuración inicial
            </button>
          </div>
        </div>
      );
    }
    return (
      <ConnectServerPage
        desktopHint={desktop && !mobile}
        onBackToSetup={mobile ? resetToInitialSetup : undefined}
        onConnected={() => {
          setServerOk(true);
          setBootLoading(true);
        }}
      />
    );
  }

  if (bootLoading || !setup) {
    return (
      <div className="h-full flex items-center justify-center bg-surface text-muted">
        Cargando…
      </div>
    );
  }

  if (setup.needs_admin) {
    return (
      <SetupWizard
        needsAdmin
        needsStore={setup.needs_store}
        onComplete={enterApp}
      />
    );
  }

  if (!auth) {
    return (
      <LoginPage
        onSuccess={(data) => void handleLogin(data)}
        onBackToSetup={mobile ? resetToInitialSetup : undefined}
      />
    );
  }

  if (setup.needs_store) {
    return (
      <SetupWizard
        needsAdmin={false}
        needsStore
        existingAuth={auth}
        onComplete={enterApp}
      />
    );
  }

  // Escritorio sin modo forzado a caja al inicio; móvil ya eligió modo
  if (!appMode || (appMode === "cocina" && !stationZoneId)) {
    return (
      <ModeSelectPage
        zoneOnly={appMode === "cocina" && !stationZoneId}
        modeOnly={false}
        onChosen={(mode, zoneId) => {
          setAppMode(mode);
          setStationZoneId(zoneId);
        }}
      />
    );
  }

  if (appMode === "cocina" && stationZoneId) {
    return (
      <KitchenPage
        zoneId={stationZoneId}
        onChangeStation={() => {
          clearAppMode();
          setAppMode(mobile ? null : "caja");
          setStationZoneId(null);
        }}
        onLogout={logout}
      />
    );
  }

  const isAdmin = auth.role === "Administrador";

  const tabs: { id: Tab; label: string; adminOnly?: boolean }[] = [
    { id: "pos", label: "Caja" },
    { id: "products", label: "Productos", adminOnly: true },
    { id: "inventory", label: "Inventario", adminOnly: true },
    { id: "hardware", label: "Impresoras", adminOnly: true },
  ];

  const visibleTabs = tabs.filter((t) => !t.adminOnly || isAdmin);
  const currentTabLabel = visibleTabs.find((t) => t.id === tab)?.label ?? "Caja";

  return (
    <div className="h-full flex flex-col bg-surface">
      <header className="flex items-center justify-between gap-3 px-4 lg:px-6 py-3 border-b border-border bg-white">
        <div className="flex items-center gap-3 min-w-0">
          <p className="text-lg font-semibold tracking-tight shrink-0 truncate max-w-[120px] sm:max-w-[160px]">
            {storeName}
          </p>
          {isPhone ? (
            <button
              type="button"
              onClick={() => setNavOpen(true)}
              className="min-h-11 px-4 rounded-2xl bg-ink text-white text-sm font-medium shrink-0"
            >
              {currentTabLabel} ▾
            </button>
          ) : (
            <nav className="flex gap-1 overflow-x-auto hide-scrollbar">
              {visibleTabs.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  className={`min-h-11 px-4 rounded-2xl text-sm font-medium ${
                    tab === t.id ? "bg-ink text-white" : "text-muted hover:bg-surface"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </nav>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="hidden sm:inline-flex min-h-11 px-3 rounded-2xl text-xs text-muted hover:bg-surface"
            onClick={() => {
              clearAppMode();
              setAppMode(null);
              setStationZoneId(null);
            }}
            title="Cambiar modo"
          >
            Modo
          </button>
          <ProfileMenu auth={auth} onAction={onProfileAction} />
        </div>
      </header>

      <main className="flex-1 min-h-0">
        {loadError ? <div className="p-6 text-danger">{loadError}</div> : null}
        {tab === "pos" ? (
          <PosPage
            auth={auth}
            products={products}
            printerAlert={printerAlert}
            onOrderDone={() => {
              void loadCatalog();
            }}
          />
        ) : null}
        {tab === "products" && isAdmin ? (
          <ProductsPage onCatalogChanged={() => void loadCatalog()} />
        ) : null}
        {tab === "inventory" && isAdmin ? <InventoryPage /> : null}
        {tab === "hardware" && isAdmin ? <PrintersPage /> : null}
      </main>

      <ReadyToast />

      {isPhone ? (
        <BottomSheet
          open={navOpen}
          title="Secciones"
          subtitle="Elige qué pantalla abrir"
          onClose={() => setNavOpen(false)}
          heightClass="h-auto max-h-[70vh]"
        >
          <div className="space-y-2 pb-4">
            {visibleTabs.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  setTab(t.id);
                  setNavOpen(false);
                }}
                className={`w-full min-h-14 px-4 rounded-2xl text-left text-base font-medium border ${
                  tab === t.id
                    ? "bg-ink text-white border-ink"
                    : "bg-white border-border text-ink"
                }`}
              >
                {t.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                clearAppMode();
                setAppMode(null);
                setStationZoneId(null);
                setNavOpen(false);
              }}
              className="w-full min-h-12 px-4 rounded-2xl text-left text-sm text-muted"
            >
              Cambiar modo (Caja / Preparación)
            </button>
          </div>
        </BottomSheet>
      ) : null}

      <ProfilesPanel open={profilesOpen} onClose={() => setProfilesOpen(false)} />
      <StoreInfoPanel
        open={storeOpen}
        onClose={() => setStoreOpen(false)}
        onSaved={(s) => setStoreName(s.name || "LocalComida")}
      />
      <SalesPanel open={salesOpen} onClose={() => setSalesOpen(false)} />
      <CashClosePanel open={cashCloseOpen} onClose={() => setCashCloseOpen(false)} />
      <ConnectTabletsPanel
        open={connectTabletsOpen}
        onClose={() => setConnectTabletsOpen(false)}
      />
    </div>
  );
}
