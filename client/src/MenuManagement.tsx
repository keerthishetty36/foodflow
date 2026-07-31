import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Search, Edit2, Trash2, Plus, X, Filter } from "lucide-react";
import { api, get } from "./api";
import { Loading, QueryError, money } from "./components";

// Ensure we re-use the exact same logic for menuImage as other places, or just fetch it
const menuImage = (name: string) => `/images/menu/${name.trim().toLowerCase().replace(/\s+/g, "-")}.jpg`;
const defaultFoodImage = "/images/menu/default-food.jpg";

export function MenuManagement() {
  const qc = useQueryClient();
  
  const categoriesQuery = useQuery({ queryKey: ["categories"], queryFn: () => get<any[]>("/categories") });
  const menuItemsQuery = useQuery({ queryKey: ["menu-items"], queryFn: () => get<any[]>("/menu-items") });
  
  const [activeCategory, setActiveCategory] = useState<string>("ALL");
  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState("NEWEST");
  const [filterVeg, setFilterVeg] = useState("ALL");
  const [filterAvailability, setFilterAvailability] = useState("ALL");
  
  const [categoryModal, setCategoryModal] = useState<{ show: boolean, data: any }>({ show: false, data: null });
  const [menuModal, setMenuModal] = useState<{ show: boolean, data: any }>({ show: false, data: null });
  const [deleteConfirmation, setDeleteConfirmation] = useState<{ show: boolean, type: "category" | "menu-item", id: string, name: string } | null>(null);
  
  const saveCategory = useMutation({
    mutationFn: async (data: any) => {
      const payload = { name: data.name, description: data.description, active: data.active };
      return data.id ? await api.patch(`/categories/${data.id}`, payload) : await api.post("/categories", payload);
    },
    onSuccess: () => {
      setCategoryModal({ show: false, data: null });
      qc.invalidateQueries({ queryKey: ["categories"] });
    },
  });

  const deleteCategory = useMutation({
    mutationFn: async (id: string) => await api.delete(`/categories/${id}`),
    onSuccess: () => {
      setDeleteConfirmation(null);
      qc.invalidateQueries({ queryKey: ["categories"] });
    },
    onError: (err: any) => {
      alert(err.response?.data?.message || "Cannot delete category");
      setDeleteConfirmation(null);
    }
  });

  const saveMenuItem = useMutation({
    mutationFn: async (data: any) => {
      const payload = {
        name: data.name,
        categoryId: data.categoryId,
        price: Number(data.price),
        costPrice: Number(data.costPrice),
        vegType: data.vegType,
        description: data.description,
        available: data.available
      };
      return data.id ? await api.patch(`/menu-items/${data.id}`, payload) : await api.post("/menu-items", payload);
    },
    onSuccess: () => {
      setMenuModal({ show: false, data: null });
      qc.invalidateQueries({ queryKey: ["menu-items"] });
    },
    onError: (err: any) => {
      alert(err.response?.data?.message || "Failed to save menu item");
    }
  });

  const deleteMenuItem = useMutation({
    mutationFn: async (id: string) => await api.delete(`/menu-items/${id}`),
    onSuccess: () => {
      setDeleteConfirmation(null);
      qc.invalidateQueries({ queryKey: ["menu-items"] });
    },
  });

  if (categoriesQuery.isPending || menuItemsQuery.isPending) return <Loading />;
  if (categoriesQuery.isError) return <QueryError error={categoriesQuery.error} />;
  if (menuItemsQuery.isError) return <QueryError error={menuItemsQuery.error} />;

  const categories = categoriesQuery.data || [];
  const allMenuItems = menuItemsQuery.data || [];

  let filteredItems = allMenuItems;
  if (activeCategory !== "ALL") {
    filteredItems = filteredItems.filter((i: any) => i.categoryId === activeCategory);
  }
  if (search) {
    const s = search.toLowerCase();
    filteredItems = filteredItems.filter((i: any) => {
      const c = categories.find((cat: any) => cat.id === i.categoryId);
      return i.name.toLowerCase().includes(s) || (c && c.name.toLowerCase().includes(s));
    });
  }
  if (filterVeg !== "ALL") {
    filteredItems = filteredItems.filter((i: any) => i.vegType === filterVeg);
  }
  if (filterAvailability !== "ALL") {
    const isAvail = filterAvailability === "AVAILABLE";
    filteredItems = filteredItems.filter((i: any) => i.available === isAvail);
  }

  filteredItems.sort((a: any, b: any) => {
    switch (sortField) {
      case "PRICE_ASC": return a.price - b.price;
      case "PRICE_DESC": return b.price - a.price;
      case "NAME_ASC": return a.name.localeCompare(b.name);
      case "OLDEST": return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      case "NEWEST":
      default: return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    }
  });

  return (
    <div className="flex h-[calc(100vh-4rem)] bg-slate-900 text-slate-200">
      {/* Sidebar: Categories */}
      <div className="w-64 border-r border-slate-700 bg-slate-800 flex flex-col">
        <div className="p-4 border-b border-slate-700 flex justify-between items-center">
          <h2 className="text-lg font-bold text-white">Categories</h2>
          <button 
            onClick={() => setCategoryModal({ show: true, data: {} })}
            className="p-1 rounded bg-orange-600 text-white hover:bg-orange-500"
            title="Add Category"
          ><Plus size={18} /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          <div 
            className={`cursor-pointer px-3 py-2 rounded-lg ${activeCategory === "ALL" ? "bg-brand-600 text-white font-medium" : "hover:bg-slate-700"}`}
            onClick={() => setActiveCategory("ALL")}
          >
            All Items
          </div>
          {categories.map((cat: any) => (
            <div 
              key={cat.id} 
              className={`group flex items-center justify-between cursor-pointer px-3 py-2 rounded-lg ${activeCategory === cat.id ? "bg-brand-600 text-white font-medium" : "hover:bg-slate-700"}`}
              onClick={() => setActiveCategory(cat.id)}
            >
              <span className="truncate">{cat.name}</span>
              <div className="hidden group-hover:flex items-center gap-1">
                <button onClick={(e) => { e.stopPropagation(); setCategoryModal({ show: true, data: cat }); }} className="p-1 text-slate-300 hover:text-white"><Edit2 size={14} /></button>
                <button onClick={(e) => { e.stopPropagation(); setDeleteConfirmation({ show: true, type: "category", id: cat.id, name: cat.name }); }} className="p-1 text-red-400 hover:text-red-300"><Trash2 size={14} /></button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Main Panel: Menu Items */}
      <div className="flex-1 flex flex-col bg-slate-900">
        <div className="p-4 border-b border-slate-700 flex flex-wrap gap-4 items-center justify-between">
          <div className="flex items-center gap-4 flex-1">
            <div className="relative w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input 
                type="text" 
                placeholder="Search Menu..." 
                className="w-full pl-9 pr-3 py-2 rounded-lg bg-slate-800 border border-slate-700 focus:outline-none focus:border-brand-500"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
            <select className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 outline-none" value={filterVeg} onChange={e => setFilterVeg(e.target.value)}>
              <option value="ALL">All Types</option>
              <option value="VEG">Veg</option>
              <option value="NON_VEG">Non-Veg</option>
              <option value="EGG">Egg</option>
            </select>
            <select className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 outline-none" value={filterAvailability} onChange={e => setFilterAvailability(e.target.value)}>
              <option value="ALL">All Availability</option>
              <option value="AVAILABLE">Available</option>
              <option value="UNAVAILABLE">Unavailable</option>
            </select>
            <select className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 outline-none" value={sortField} onChange={e => setSortField(e.target.value)}>
              <option value="NEWEST">Newest</option>
              <option value="OLDEST">Oldest</option>
              <option value="PRICE_ASC">Price: Low to High</option>
              <option value="PRICE_DESC">Price: High to Low</option>
              <option value="NAME_ASC">Name: A-Z</option>
            </select>
          </div>
          <button 
            onClick={() => setMenuModal({ show: true, data: { categoryId: activeCategory === "ALL" ? (categories[0]?.id || "") : activeCategory, vegType: "VEG", available: true, price: "", costPrice: "" } })}
            className="flex items-center gap-2 bg-orange-600 hover:bg-orange-500 text-white px-4 py-2 rounded-lg font-medium shadow"
          >
            <Plus size={18} /> Add Menu Item
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {filteredItems.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-500">
              <p className="mb-4">No menu items found.</p>
              <button 
                onClick={() => setMenuModal({ show: true, data: { categoryId: activeCategory === "ALL" ? (categories[0]?.id || "") : activeCategory, vegType: "VEG", available: true, price: "", costPrice: "" } })}
                className="flex items-center gap-2 text-brand-500 hover:text-brand-400"
              ><Plus size={16} /> Add Menu Item</button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {filteredItems.map((item: any) => (
                <div key={item.id} className="bg-slate-800 rounded-2xl border border-slate-700 shadow-md overflow-hidden flex flex-col">
                  <div className="relative h-40">
                    <img 
                      src={menuImage(item.name)} 
                      alt={item.name} 
                      className="w-full h-full object-cover"
                      onError={(e) => { e.currentTarget.src = defaultFoodImage; }}
                    />
                    <div className="absolute top-2 right-2 flex gap-1">
                      {item.vegType === "VEG" && <span className="bg-green-600 text-xs px-2 py-1 rounded text-white font-bold">VEG</span>}
                      {item.vegType === "NON_VEG" && <span className="bg-red-600 text-xs px-2 py-1 rounded text-white font-bold">NON VEG</span>}
                      {item.vegType === "EGG" && <span className="bg-yellow-600 text-xs px-2 py-1 rounded text-white font-bold">EGG</span>}
                    </div>
                  </div>
                  <div className="p-4 flex-1 flex flex-col">
                    <div className="flex justify-between items-start mb-1">
                      <h3 className="font-bold text-lg text-white">{item.name}</h3>
                      <span className="font-bold text-brand-500">{money(item.price)}</span>
                    </div>
                    <p className="text-sm text-slate-400 mb-2">{categories.find((c: any) => c.id === item.categoryId)?.name || "Unknown Category"}</p>
                    <p className="text-sm text-slate-300 flex-1 line-clamp-2">{item.description}</p>
                    
                    <div className="mt-4 flex items-center justify-between border-t border-slate-700 pt-3">
                      <span className={`text-xs px-2 py-1 rounded-full ${item.available ? 'bg-green-500/20 text-green-400' : 'bg-slate-600 text-slate-300'}`}>
                        {item.available ? 'Available' : 'Unavailable'}
                      </span>
                      <div className="flex items-center gap-2">
                        <button onClick={() => setMenuModal({ show: true, data: item })} className="p-1.5 text-slate-300 hover:text-white bg-slate-700 rounded-lg hover:bg-slate-600"><Edit2 size={16} /></button>
                        <button onClick={() => setDeleteConfirmation({ show: true, type: "menu-item", id: item.id, name: item.name })} className="p-1.5 text-red-400 hover:text-red-300 bg-slate-700 rounded-lg hover:bg-slate-600"><Trash2 size={16} /></button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Category Modal */}
      {categoryModal.show && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 rounded-2xl w-full max-w-md shadow-2xl border border-slate-700 flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-slate-700">
              <h3 className="font-bold text-lg text-white">{categoryModal.data.id ? "Edit Category" : "Add Category"}</h3>
              <button onClick={() => setCategoryModal({ show: false, data: null })} className="text-slate-400 hover:text-white"><X size={20} /></button>
            </div>
            <form onSubmit={(e) => { e.preventDefault(); saveCategory.mutate(categoryModal.data); }} className="p-4 space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Category Name</label>
                <input required autoFocus type="text" className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 outline-none focus:border-brand-500" value={categoryModal.data.name || ""} onChange={e => setCategoryModal({ ...categoryModal, data: { ...categoryModal.data, name: e.target.value } })} />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Description (Optional)</label>
                <textarea className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 outline-none focus:border-brand-500" value={categoryModal.data.description || ""} onChange={e => setCategoryModal({ ...categoryModal, data: { ...categoryModal.data, description: e.target.value } })} />
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" id="cat-active" checked={categoryModal.data.active !== false} onChange={e => setCategoryModal({ ...categoryModal, data: { ...categoryModal.data, active: e.target.checked } })} />
                <label htmlFor="cat-active" className="text-sm font-medium">Active Status</label>
              </div>
              <div className="pt-4 flex justify-end gap-3">
                <button type="button" onClick={() => setCategoryModal({ show: false, data: null })} className="px-4 py-2 text-slate-300 hover:text-white">Cancel</button>
                <button type="submit" disabled={saveCategory.isPending} className="px-4 py-2 bg-brand-600 hover:bg-brand-500 text-white rounded-lg font-medium disabled:opacity-50">Save</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Menu Item Modal */}
      {menuModal.show && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 rounded-2xl w-full max-w-xl shadow-2xl border border-slate-700 flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between p-4 border-b border-slate-700">
              <h3 className="font-bold text-lg text-white">{menuModal.data.id ? "Edit Menu Item" : "Add Menu Item"}</h3>
              <button onClick={() => setMenuModal({ show: false, data: null })} className="text-slate-400 hover:text-white"><X size={20} /></button>
            </div>
            <div className="p-4 overflow-y-auto">
              <form id="menu-form" onSubmit={(e) => { e.preventDefault(); saveMenuItem.mutate(menuModal.data); }} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-1">Food Name</label>
                    <input required autoFocus type="text" className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 outline-none focus:border-brand-500" value={menuModal.data.name || ""} onChange={e => setMenuModal({ ...menuModal, data: { ...menuModal.data, name: e.target.value } })} />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Category</label>
                    <select required className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 outline-none focus:border-brand-500" value={menuModal.data.categoryId || ""} onChange={e => setMenuModal({ ...menuModal, data: { ...menuModal.data, categoryId: e.target.value } })}>
                      <option value="" disabled>Select Category</option>
                      {categories.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Price</label>
                    <input required type="number" step="0.01" min="0" className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 outline-none focus:border-brand-500" value={menuModal.data.price} onChange={e => setMenuModal({ ...menuModal, data: { ...menuModal.data, price: e.target.value } })} />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Cost Price</label>
                    <input required type="number" step="0.01" min="0" className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 outline-none focus:border-brand-500" value={menuModal.data.costPrice} onChange={e => setMenuModal({ ...menuModal, data: { ...menuModal.data, costPrice: e.target.value } })} />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Veg Type</label>
                    <select required className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 outline-none focus:border-brand-500" value={menuModal.data.vegType || "VEG"} onChange={e => setMenuModal({ ...menuModal, data: { ...menuModal.data, vegType: e.target.value } })}>
                      <option value="VEG">Veg</option>
                      <option value="NON_VEG">Non-Veg</option>
                      <option value="EGG">Egg</option>
                    </select>
                  </div>
                  <div className="flex items-center h-full pt-6">
                    <div className="flex items-center gap-2">
                      <input type="checkbox" id="menu-avail" className="w-4 h-4" checked={menuModal.data.available !== false} onChange={e => setMenuModal({ ...menuModal, data: { ...menuModal.data, available: e.target.checked } })} />
                      <label htmlFor="menu-avail" className="text-sm font-medium">Available for Sale</label>
                    </div>
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium mb-1">Description (Optional)</label>
                    <textarea rows={3} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 outline-none focus:border-brand-500" value={menuModal.data.description || ""} onChange={e => setMenuModal({ ...menuModal, data: { ...menuModal.data, description: e.target.value } })} />
                  </div>
                </div>
              </form>
            </div>
            <div className="p-4 border-t border-slate-700 flex justify-end gap-3">
              <button type="button" onClick={() => setMenuModal({ show: false, data: null })} className="px-4 py-2 text-slate-300 hover:text-white">Cancel</button>
              <button form="menu-form" type="submit" disabled={saveMenuItem.isPending} className="px-4 py-2 bg-brand-600 hover:bg-brand-500 text-white rounded-lg font-medium disabled:opacity-50">Save Menu Item</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation */}
      {deleteConfirmation && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 rounded-2xl w-full max-w-sm shadow-2xl border border-slate-700 p-6 text-center">
            <Trash2 size={40} className="mx-auto text-red-500 mb-4" />
            <h3 className="font-bold text-xl text-white mb-2">Delete {deleteConfirmation.type === "category" ? "Category" : "Menu Item"}?</h3>
            <p className="text-slate-300 mb-6">Are you sure you want to delete <b className="text-white">{deleteConfirmation.name}</b>? This action cannot be undone.</p>
            <div className="flex justify-center gap-3">
              <button onClick={() => setDeleteConfirmation(null)} className="flex-1 px-4 py-2 text-slate-300 hover:bg-slate-700 rounded-lg font-medium">Cancel</button>
              <button onClick={() => deleteConfirmation.type === "category" ? deleteCategory.mutate(deleteConfirmation.id) : deleteMenuItem.mutate(deleteConfirmation.id)} disabled={deleteCategory.isPending || deleteMenuItem.isPending} className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg font-medium disabled:opacity-50">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
