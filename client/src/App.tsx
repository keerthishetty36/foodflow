import { Component, type ErrorInfo, type ReactNode, useEffect } from "react";import { Navigate,Route,Routes,useLocation } from "react-router-dom";import { useAuthStore } from "./store";import { api } from "./api";import { Shell } from "./components";import { Login,Dashboard,Pos,Kitchen,Orders,Notifications,Resource,Reports,Settings,MenuManagement } from "./pages";import { Roles } from "./Roles";import { Users } from "./Users";

const ROUTE_PERMISSIONS = [
  { path: "/dashboard", req: "dashboard.view" },
  { path: "/pos", req: "pos.view" },
  { path: "/kitchen", req: "orders.view" },
  { path: "/orders", req: "orders.view" },
  { path: "/menu", req: "menu.read" },
  { path: "/tables", req: "tables.view" },
  { path: "/inventory", req: "inventory.view" },
  { path: "/suppliers", req: "suppliers.view" },
  { path: "/reports", req: "reports.view" },
  { path: "/notifications", req: "notifications.view" },
  { path: "/settings", req: "settings.view" },
  { path: "/roles", req: "roles.read" },
  { path: "/users", req: "users.view" }
];

function getFirstPermittedRoute(permissions: string[] | undefined) {
  if (!permissions) return "/login";
  if (permissions.includes("*")) return "/dashboard";
  for (const { path, req } of ROUTE_PERMISSIONS) {
    if (permissions.includes(req)) return path;
  }
  return "/unauthorized";
}

class PageErrorBoundary extends Component<{children:ReactNode},{failed:boolean}>{state={failed:false};static getDerivedStateFromError(){return {failed:true}}componentDidCatch(error:Error,info:ErrorInfo){console.error("Page render failed",error,info)}render(){return this.state.failed?<div className="card"><h2 className="text-lg font-bold">This page could not be displayed</h2><p className="mt-2 text-sm text-slate-500">Please refresh the page or try again.</p></div>:this.props.children}}

function Protected({ children, requiredPermission }: { children: ReactNode; requiredPermission?: string }) {
  const { user, initialized } = useAuthStore(), location = useLocation();
  if (!initialized) return <div className="min-h-screen bg-orange-50"/>;
  if (!user) return <Navigate to="/login" replace/>;
  if (requiredPermission && !user.permissions?.includes("*") && !user.permissions?.includes(requiredPermission)) {
    const fallback = getFirstPermittedRoute(user.permissions);
    if (location.pathname === fallback) return <Navigate to="/unauthorized" replace/>;
    return <Navigate to={fallback} replace/>;
  }
  return <Shell><PageErrorBoundary key={location.pathname}>{children}</PageErrorBoundary></Shell>;
}

function RootRedirect() {
  const { user, initialized } = useAuthStore();
  if (!initialized) return <div className="min-h-screen bg-orange-50"/>;
  if (!user) return <Navigate to="/login" replace/>;
  return <Navigate to={getFirstPermittedRoute(user.permissions)} replace/>;
}

function Unauthorized() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="card text-center max-w-sm w-full p-8">
        <h1 className="text-2xl font-bold text-slate-800">Access Denied</h1>
        <p className="mt-2 text-slate-500">You do not have permission to access any modules in the system.</p>
        <button className="btn btn-primary mt-6 w-full" onClick={async () => { await api.post('/auth/logout').catch(() => {}); useAuthStore.getState().clear(); }}>Sign out</button>
      </div>
    </div>
  );
}

function App() {
  const set = useAuthStore(s => s.setSession), setInitialized = useAuthStore(s => s.setInitialized);
  useEffect(() => {
    let active = true;
    api.post('/auth/refresh').then(r => { if (active) set(r.data.data) }).catch(() => { if (active) setInitialized() });
    return () => { active = false };
  }, [set, setInitialized]);
  return <Routes>
    <Route path="/login" element={<Login/>}/>
    <Route path="/" element={<RootRedirect/>}/>
    <Route path="/kitchen" element={<Protected requiredPermission="orders.view"><Kitchen/></Protected>}/>
    <Route path="/dashboard" element={<Protected requiredPermission="dashboard.view"><Dashboard/></Protected>}/>
    <Route path="/pos" element={<Protected requiredPermission="pos.view"><Pos/></Protected>}/>
    <Route path="/orders" element={<Protected requiredPermission="orders.view"><Orders/></Protected>}/>
    <Route path="/menu" element={<Protected requiredPermission="menu.read"><MenuManagement/></Protected>}/>
    <Route path="/tables" element={<Protected requiredPermission="tables.view"><Resource type="tables"/></Protected>}/>
    <Route path="/inventory" element={<Protected requiredPermission="inventory.view"><Resource type="inventory"/></Protected>}/>
    <Route path="/suppliers" element={<Protected requiredPermission="suppliers.view"><Resource type="suppliers"/></Protected>}/>
    <Route path="/reports" element={<Protected requiredPermission="reports.view"><Reports/></Protected>}/>
    <Route path="/notifications" element={<Protected requiredPermission="notifications.view"><Notifications/></Protected>}/>
    <Route path="/settings" element={<Protected requiredPermission="settings.view"><Settings/></Protected>}/>
    <Route path="/roles" element={<Protected requiredPermission="roles.read"><Roles/></Protected>}/>
    <Route path="/users" element={<Protected requiredPermission="users.view"><Users/></Protected>}/>
    <Route path="/cashier" element={<Navigate to="/pos" replace/>}/> 
    <Route path="/unauthorized" element={<Unauthorized/>}/>
    <Route path="*" element={<Navigate to="/"/>}/>
  </Routes>;
}
export default App;
