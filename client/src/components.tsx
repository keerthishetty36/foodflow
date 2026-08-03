import type { ReactNode } from "react";import { NavLink } from "react-router-dom";import { LayoutDashboard,UtensilsCrossed,ReceiptText,ChefHat,Package,Settings,LogOut,Table2,BarChart3,ShoppingCart,ClipboardList,Bell,Users,Shield } from "lucide-react";import { useAuthStore } from "./store";import { api } from "./api";
const ADMIN_ROLE="ADMIN" as const;
const links=[['/dashboard','Dashboard',LayoutDashboard],['/pos','POS Billing',ShoppingCart],['/kitchen','Kitchen Screen',ChefHat],['/orders','Orders',ReceiptText],['/menu','Menu',UtensilsCrossed],['/tables','Tables',Table2],['/inventory','Inventory',Package],['/suppliers','Suppliers',ClipboardList],['/reports','Reports',BarChart3],['/notifications','Notifications',Bell],['/settings','Settings',Settings],['/users','Users',Users],['/roles','Roles',Shield],['/cashier','Cashier Dashboard',ShoppingCart]] as const;
const permissionMap: Record<string, string> = {
  '/dashboard': 'dashboard.view', '/pos': 'pos.view', '/kitchen': 'orders.view', '/orders': 'orders.view', '/menu': 'menu.read', '/tables': 'tables.view',
  '/inventory': 'inventory.view', '/suppliers': 'suppliers.view', '/reports': 'reports.view', '/notifications': 'notifications.view', '/settings': 'settings.view',
  '/users': 'users.view', '/roles': 'roles.read', '/cashier': 'pos.view'
};
export function Shell({children}:{children:ReactNode}){const {user,clear,workspaceMode,setWorkspaceMode}=useAuthStore();
const visible=links.filter(([path])=>{if(workspaceMode)return ['/pos','/kitchen','/orders','/tables'].includes(path);
const req=permissionMap[path];if(!req)return true;return user?.permissions?.includes("*")||user?.permissions?.includes(req);});
return <div className="min-h-screen lg:flex"><aside className="w-full border-b bg-white p-4 dark:border-slate-800 dark:bg-slate-900 lg:fixed lg:inset-y-0 lg:w-64 lg:border-r lg:border-b-0"><div className="mb-6 flex items-center gap-2 text-xl font-bold text-brand-600"><UtensilsCrossed/> FoodFlow</div><nav className="grid grid-cols-3 gap-1 lg:block">{visible.map(([to,label,Icon])=><NavLink key={to} to={to} end={to==='/dashboard'} className="nav-link" onClick={()=>{if(to==='/cashier')setWorkspaceMode(true)}}><Icon size={18}/><span className="hidden lg:inline">{label}</span></NavLink>)}</nav>{workspaceMode&&user?.role===ADMIN_ROLE?<NavLink to="/dashboard" className="nav-link mt-4 w-full bg-brand-50 font-bold text-brand-700" onClick={()=>{setWorkspaceMode(false)}}><LayoutDashboard size={18}/><span className="hidden lg:inline">Back to Admin</span></NavLink>:null}<button className="nav-link mt-4 w-full" onClick={async()=>{await api.post('/auth/logout').catch(()=>{});clear()}}><LogOut size={18}/><span className="hidden lg:inline">Sign out</span></button></aside><main className="min-w-0 flex-1 p-4 lg:ml-64 lg:p-8"><header className="mb-6 flex items-center justify-between"><div><p className="text-sm text-slate-500">{new Date().toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'})}</p><h1 className="text-xl font-bold">Welcome, {user?.name}</h1></div><span className="rounded-full bg-brand-50 px-3 py-1 text-xs font-bold text-brand-700">{user?.role}{workspaceMode&&' (Cashier Workspace)'}</span></header>{children}</main></div>}
export const money=(n:number)=>new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR'}).format(n||0);
export function Loading(){return <div className="grid gap-4 md:grid-cols-3">{[1,2,3,4,5,6].map(i=><div className="card h-28 animate-pulse bg-slate-200 dark:bg-slate-800" key={i}/>)}</div>}
export function QueryError({error}:{error:unknown}){const message=(error as {response?:{data?:{message?:string}};message?:string})?.response?.data?.message||(error as Error)?.message||"Unable to load this page.";return <div className="card"><h2 className="text-lg font-bold">Unable to load data</h2><p className="mt-2 text-sm text-red-600">{message}</p></div>}
export function EmptyState({message="No records found."}:{message?:string}){return <p className="py-6 text-sm text-slate-500">{message}</p>}

export function PlaceholderImage({ name, className }: { name: string, className?: string }) {
  const text = name ? name.substring(0, 2).toUpperCase() : "??";
  return (
    <div className={`w-full h-full bg-slate-800 flex items-center justify-center overflow-hidden ${className || ""}`}>
      <span className="text-3xl font-bold text-orange-500">{text}</span>
    </div>
  );
}
