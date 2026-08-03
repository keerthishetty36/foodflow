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

  const save = useMutation({
    mutationFn: async () => {
      const payload: any = { ...form };
      if (!payload.password) delete payload.password;
      if (!payload.roleId) payload.roleId = null;
      if (editing?.id) return api.patch(`/users/${editing.id}`, payload);
      return api.post("/users", payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
      setEditing(null);
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
        <button className="btn btn-primary" onClick={() => { setForm({ name: "", email: "", password: "", roleId: "", role: "CASHIER" }); setEditing({}); }}>
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
                      <button className="p-2 border rounded-md" onClick={() => { setForm({ name: u.name, email: u.email, password: "", roleId: u.customRole?.id || "", role: u.role }); setEditing(u); }}>
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
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg overflow-hidden">
            <div className="p-6">
              <h2 className="text-xl font-bold mb-4">{editing?.id ? "Edit User" : "Create User"}</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Name</label>
                  <input className="input" value={form.name} onChange={(e: any) => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. John Doe" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Email</label>
                  <input className="input" type="email" value={form.email} onChange={(e: any) => setForm(f => ({ ...f, email: e.target.value }))} disabled={!!editing?.id} placeholder="e.g. john@example.com" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">{editing?.id ? "New Password (Optional)" : "Password"}</label>
                  <input className="input" type="password" value={form.password} onChange={(e: any) => setForm(f => ({ ...f, password: e.target.value }))} placeholder={editing?.id ? "Leave blank to keep unchanged" : "••••••••"} />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Base Role</label>
                  <select className="input" value={form.role} onChange={(e: any) => setForm(f => ({ ...f, role: e.target.value }))}>
                    <option value="CASHIER">CASHIER</option>
                    <option value="ADMIN">ADMIN</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Custom Role (Overrides Base Role Permissions)</label>
                  <select className="input" value={form.roleId} onChange={(e: any) => setForm(f => ({ ...f, roleId: e.target.value }))}>
                    <option value="">None</option>
                    {roles.map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                </div>

                <div className="flex justify-end gap-3 pt-4 border-t">
                  <button className="btn outline" onClick={() => setEditing(null)}>Cancel</button>
                  <button className="btn btn-primary" onClick={() => save.mutate()} disabled={save.isPending}>
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
