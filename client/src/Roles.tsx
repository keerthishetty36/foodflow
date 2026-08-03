import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Edit2, Trash2, Loader2, Save } from "lucide-react";
import { api } from "./api";

const AVAILABLE_PERMISSIONS = [
  "dashboard.view", "pos.view", "pos.bill", "orders.view", "orders.update",
  "menu.read", "menu.write", "menu.delete", "tables.view",
  "inventory.view", "inventory.write", "suppliers.view", "suppliers.write",
  "reports.view", "notifications.view", "settings.view", "settings.edit",
  "users.view", "users.create", "users.edit", "users.delete",
  "roles.read", "roles.edit", "roles.delete"
];

export function Roles() {
  const qc = useQueryClient();
  const { data: roles = [], isLoading } = useQuery({
    queryKey: ["roles"],
    queryFn: () => api.get("/roles").then((res: any) => res.data.data)
  });
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({ name: "", description: "", permissions: [] as string[] });

  const save = useMutation({
    mutationFn: async () => {
      if (editing?.id) return api.patch(`/roles/${editing.id}`, form);
      return api.post("/roles", form);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["roles"] });
      setEditing(null);
    }
  });

  const remove = useMutation({
    mutationFn: async (id: string) => api.delete(`/roles/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["roles"] })
  });

  const togglePermission = (perm: string) => {
    setForm(f => ({
      ...f,
      permissions: f.permissions.includes(perm)
        ? f.permissions.filter(p => p !== perm)
        : [...f.permissions, perm]
    }));
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Roles & Permissions</h1>
          <p className="text-slate-500">Manage user roles and their access levels.</p>
        </div>
        <button className="btn btn-primary" onClick={() => { setForm({ name: "", description: "", permissions: [] }); setEditing({}); }}>
          <Plus className="w-4 h-4 mr-2 inline" /> Create Role
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
                <th className="text-left py-3 px-4 font-semibold text-sm text-slate-600">Description</th>
                <th className="text-left py-3 px-4 font-semibold text-sm text-slate-600">Permissions</th>
                <th className="text-right py-3 px-4 font-semibold text-sm text-slate-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {roles.map((r: any) => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="py-3 px-4 font-medium">{r.name}</td>
                  <td className="py-3 px-4 text-slate-500">{r.description || "-"}</td>
                  <td className="py-3 px-4">
                    <span className="inline-flex items-center px-2 py-1 rounded-md bg-blue-50 text-blue-700 text-xs font-medium">
                      {r.permissions.length} permissions
                    </span>
                  </td>
                  <td className="py-3 px-4 text-right">
                    <div className="flex justify-end gap-2">
                      <button className="p-2 border rounded-md" onClick={() => { setForm({ name: r.name, description: r.description || "", permissions: r.permissions }); setEditing(r); }}>
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button className="p-2 border rounded-md" onClick={() => { if(confirm("Are you sure?")) remove.mutate(r.id); }}>
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
              <h2 className="text-xl font-bold mb-4">{editing?.id ? "Edit Role" : "Create Role"}</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Role Name</label>
                  <input className="input" value={form.name} onChange={(e: any) => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Manager" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Description</label>
                  <input className="input" value={form.description} onChange={(e: any) => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Optional description" />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Permissions</label>
                  <div className="grid grid-cols-2 gap-2 max-h-64 overflow-y-auto p-4 border rounded-lg bg-slate-50">
                    <label className="flex items-center gap-2 cursor-pointer col-span-2 pb-2 border-b">
                      <input type="checkbox" className="rounded text-orange-600 focus:ring-orange-500" checked={form.permissions.includes("*")} onChange={() => togglePermission("*")} />
                      <span className="font-semibold">Full Access (*)</span>
                    </label>
                    {AVAILABLE_PERMISSIONS.map(p => (
                      <label key={p} className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" className="rounded text-orange-600 focus:ring-orange-500" checked={form.permissions.includes(p) || form.permissions.includes("*")} disabled={form.permissions.includes("*")} onChange={() => togglePermission(p)} />
                        <span className="text-sm">{p}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="flex justify-end gap-3 pt-4 border-t">
                  <button className="btn outline" onClick={() => setEditing(null)}>Cancel</button>
                  <button className="btn btn-primary" onClick={() => save.mutate()} disabled={save.isPending}>
                    {save.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin inline" /> : <Save className="w-4 h-4 mr-2 inline" />}
                    Save Role
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
