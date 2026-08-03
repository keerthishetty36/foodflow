import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Edit2, Trash2, Loader2, Save } from "lucide-react";
import { api } from "./api";

export function Users() {
  const qc = useQueryClient();
  const { data: users = [], isLoading } = useQuery({
    queryKey: ["users"],
    queryFn: () => api.get("/users").then((res: any) => res.data.data)
  });
  const { data: roles = [] } = useQuery({
    queryKey: ["roles"],
    queryFn: () => api.get("/roles").then((res: any) => res.data.data)
  });
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({ name: "", email: "", password: "", roleId: "", role: "CASHIER" });
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: async () => {
      const payload: any = { ...form };
      if (!payload.password && editing?.id) delete payload.password;
      if (!payload.roleId) {
        if (editing?.id) payload.roleId = null;
        else delete payload.roleId;
      }
      if (editing?.id) return api.patch(`/users/${editing.id}`, payload);
      return api.post("/users", payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
      setEditing(null);
      setError(null);
    },
    onError: (err: any) => {
      const data = err.response?.data;
      if (data?.errors && Array.isArray(data.errors)) {
        setError(data.errors.map((e: any) => e.message).join(", "));
      } else {
        setError(data?.message || err.message);
      }
    }
  });

  const remove = useMutation({
    mutationFn: async (id: string) => api.delete(`/users/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] })
  });

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Users</h1>
          <p className="text-slate-500">Manage user accounts and roles.</p>
        </div>
        <button className="btn btn-primary" onClick={() => { setForm({ name: "", email: "", password: "", roleId: "", role: "CASHIER" }); setEditing({}); setError(null); }}>
          <Plus className="w-4 h-4 mr-2 inline" /> Create User
        </button>
      </div>

      {isLoading ? (
        <div className="flex justify-center p-8"><Loader2 className="w-8 h-8 animate-spin text-orange-500" /></div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b">
                <th className="text-left py-3 px-4 font-semibold text-sm text-slate-600">Name</th>
                <th className="text-left py-3 px-4 font-semibold text-sm text-slate-600">Email</th>
                <th className="text-left py-3 px-4 font-semibold text-sm text-slate-600">Type</th>
                <th className="text-left py-3 px-4 font-semibold text-sm text-slate-600">Custom Role</th>
                <th className="text-left py-3 px-4 font-semibold text-sm text-slate-600">Status</th>
                <th className="text-right py-3 px-4 font-semibold text-sm text-slate-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {users.map((u: any) => (
                <tr key={u.id} className="hover:bg-slate-50">
                  <td className="py-3 px-4 font-medium">{u.name}</td>
                  <td className="py-3 px-4 text-slate-500">{u.email}</td>
                  <td className="py-3 px-4">
                    <span className={`inline-flex items-center px-2 py-1 rounded-md text-xs font-medium ${u.role === 'ADMIN' ? 'bg-purple-50 text-purple-700' : 'bg-slate-100 text-slate-700'}`}>
                      {u.role}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-slate-500">{u.customRole?.name || "-"}</td>
                  <td className="py-3 px-4">
                    <span className={`inline-flex items-center px-2 py-1 rounded-md text-xs font-medium ${u.active ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                      {u.active ? "Active" : "Disabled"}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-right">
                    <div className="flex justify-end gap-2">
                      <button className="p-2 border rounded-md" onClick={() => { setForm({ name: u.name, email: u.email, password: "", roleId: u.customRole?.id || "", role: u.role }); setEditing(u); setError(null); }}>
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button className="p-2 border rounded-md" onClick={() => { if(confirm("Are you sure?")) remove.mutate(u.id); }}>
                        <Trash2 className="w-4 h-4 text-red-500" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!!editing && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-[16px] shadow-[0_8px_30px_rgb(0,0,0,0.12)] w-full max-w-[650px] overflow-hidden">
            <div className="p-6 pb-0">
              <h2 className="text-[28px] font-bold text-gray-900 leading-tight">{editing?.id ? "Edit User" : "Create User"}</h2>
              <p className="text-gray-500 mt-1 mb-6">Create a new user and assign a role.</p>
            </div>
            
            <div className="p-6 pt-0">
              {error && <div className="mb-6 p-3 bg-red-50 border border-red-200 text-red-600 rounded-md text-sm">{error}</div>}
              
              <div className="space-y-4">
                <div>
                  <label className="block text-[15px] font-semibold text-gray-900 mb-1.5">Name</label>
                  <input className="w-full h-12 px-3 rounded-[10px] bg-white border border-gray-300 text-gray-900 placeholder-gray-400 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 transition-all duration-200" value={form.name} onChange={(e: any) => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. John Doe" />
                </div>
                <div>
                  <label className="block text-[15px] font-semibold text-gray-900 mb-1.5">Email</label>
                  <input className="w-full h-12 px-3 rounded-[10px] bg-white border border-gray-300 text-gray-900 placeholder-gray-400 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 transition-all duration-200" type="email" value={form.email} onChange={(e: any) => setForm(f => ({ ...f, email: e.target.value }))} disabled={!!editing?.id} placeholder="e.g. john@example.com" />
                </div>
                <div>
                  <label className="block text-[15px] font-semibold text-gray-900 mb-1.5">{editing?.id ? "New Password (Optional)" : "Password"}</label>
                  <input className="w-full h-12 px-3 rounded-[10px] bg-white border border-gray-300 text-gray-900 placeholder-gray-400 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 transition-all duration-200" type="password" value={form.password} onChange={(e: any) => setForm(f => ({ ...f, password: e.target.value }))} placeholder={editing?.id ? "Leave blank to keep unchanged" : "••••••••"} />
                </div>
                <div>
                  <label className="block text-[15px] font-semibold text-gray-900 mb-1.5">Base Role</label>
                  <select className="w-full h-12 px-3 rounded-[10px] bg-white border border-gray-300 text-gray-900 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 transition-all duration-200" value={form.role} onChange={(e: any) => setForm(f => ({ ...f, role: e.target.value }))}>
                    <option value="CASHIER">CASHIER</option>
                    <option value="ADMIN">ADMIN</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[15px] font-semibold text-gray-900 mb-1.5">Custom Role (Overrides Base Role Permissions)</label>
                  <select className="w-full h-12 px-3 rounded-[10px] bg-white border border-gray-300 text-gray-900 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 transition-all duration-200" value={form.roleId} onChange={(e: any) => setForm(f => ({ ...f, roleId: e.target.value }))}>
                    <option value="">None</option>
                    {roles.map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                </div>

                <div className="flex justify-end gap-3 mt-6 pt-6 border-t border-gray-100">
                  <button className="h-12 px-5 rounded-[10px] border border-gray-300 bg-white text-gray-700 font-semibold hover:bg-gray-50 transition-colors" onClick={() => setEditing(null)}>Cancel</button>
                  <button className="h-12 px-5 rounded-[10px] bg-orange-500 text-white font-semibold hover:bg-orange-600 transition-colors inline-flex items-center justify-center min-w-[120px]" onClick={() => save.mutate()} disabled={save.isPending}>
                    {save.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin inline" /> : <Save className="w-4 h-4 mr-2 inline" />}
                    Save User
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
