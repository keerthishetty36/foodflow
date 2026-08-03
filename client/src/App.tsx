import { Component, type ErrorInfo, type ReactNode, useEffect } from "react";import { Navigate,Route,Routes,useLocation } from "react-router-dom";import { useAuthStore } from "./store";import { api } from "./api";import { Shell } from "./components";import { Login,Dashboard,Pos,Kitchen,Orders,Notifications,Resource,Reports,Settings,MenuManagement } from "./pages";import { Roles } from "./Roles";import { Users } from "./Users";
class PageErrorBoundary extends Component<{children:ReactNode},{failed:boolean}>{state={failed:false};static getDerivedStateFromError(){return {failed:true}}componentDidCatch(error:Error,info:ErrorInfo){console.error("Page render failed",error,info)}render(){return this.state.failed?<div className="card"><h2 className="text-lg font-bold">This page could not be displayed</h2><p className="mt-2 text-sm text-slate-500">Please refresh the page or try again.</p></div>:this.props.children}}
function Protected({ children, requiredPermission }: { children: ReactNode; requiredPermission?: string }) {
  const { user, initialized } = useAuthStore(), location = useLocation();
  if (!initialized) return <div className="min-h-screen bg-orange-50"/>;
  if (!user) return <Navigate to="/login" replace/>;
  if (requiredPermission && !user.permissions?.includes("*") && !user.permissions?.includes(requiredPermission)) return <Navigate to="/cashier" replace/>;
  return <Shell><PageErrorBoundary key={location.pathname}>{children}</PageErrorBoundary></Shell>;
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
    <Route path="/kitchen" element={<Protected><Kitchen/></Protected>}/>
    <Route path="/" element={<Navigate to="/dashboard" replace/>}/>
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
    <Route path="/unauthorized" element={<Navigate to="/cashier" replace/>}/>
    <Route path="*" element={<Navigate to="/"/>}/>
  </Routes>;
}
export default App;
